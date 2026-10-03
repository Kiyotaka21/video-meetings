import { randomUUID } from 'node:crypto'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'bun:test'

import { prisma } from '../src/db/prisma'
import { removeMeetingFiles } from '../src/modules/files/storage'
import { asFile, asFiles, createMeeting, filesPath, meetingDir, storedFiles } from './helpers/files'
import { deleteJson, getJson, postFile, requestRaw } from './helpers/http'
import { registerUser } from './helpers/users'

/**
 * Удаление файла и уборка за встречей. Файл должен исчезнуть отовсюду сразу:
 * из списка, с диска и по ссылке, выданной до удаления, — у неё `exp` ещё
 * годен, но открывать ей больше нечего.
 */

const upload = async (token: string, meetingId: string, name = 'протокол.txt') => {
  const response = await postFile(
    filesPath(meetingId),
    { name, type: 'text/plain', body: `содержимое ${name}` },
    token,
  )

  expect(response.status).toBe(201)

  return asFile(response.body)
}

const filePath = (meetingId: string, fileId: string): string => `${filesPath(meetingId)}/${fileId}`

describe('DELETE /meetings/:id/files/:fileId', () => {
  it('отвечает 204 без тела, файла нет ни в списке, ни на диске', async () => {
    const owner = await registerUser()
    const meetingId = await createMeeting(owner.token)
    const kept = await upload(owner.token, meetingId, 'остаётся.txt')
    const removed = await upload(owner.token, meetingId, 'удаляется.txt')

    const response = await deleteJson(filePath(meetingId, removed.id), owner.token)

    expect(response.status).toBe(204)
    expect(response.raw).toBe('')

    const listed = asFiles((await getJson(filesPath(meetingId), owner.token)).body)

    expect(listed.map((file) => file.id)).toEqual([kept.id])
    // Сосед на месте: удаление убирает ровно один файл, а не каталог.
    expect(storedFiles(meetingId)).toEqual([`${kept.id}.txt`])
  })

  it('ссылка, выданная до удаления, отвечает 404, хотя её токен ещё годен', async () => {
    const owner = await registerUser()
    const meetingId = await createMeeting(owner.token)
    const file = await upload(owner.token, meetingId)

    expect((await requestRaw(file.url)).status).toBe(200)

    await deleteJson(filePath(meetingId, file.id), owner.token)

    expect((await requestRaw(file.url)).status).toBe(404)
  })

  it('повторное удаление того же файла → 404', async () => {
    const owner = await registerUser()
    const meetingId = await createMeeting(owner.token)
    const file = await upload(owner.token, meetingId)

    await deleteJson(filePath(meetingId, file.id), owner.token)

    const response = await deleteJson(filePath(meetingId, file.id), owner.token)

    expect(response.status).toBe(404)
    expect(response.body).toEqual({ message: 'File not found' })
  })

  it('несуществующий файл своей встречи → 404', async () => {
    const owner = await registerUser()
    const meetingId = await createMeeting(owner.token)

    const response = await deleteJson(filePath(meetingId, randomUUID()), owner.token)

    expect(response.status).toBe(404)
  })

  it('файл из соседней встречи по пути своей → 404, и файл остаётся', async () => {
    const owner = await registerUser()
    const meetingId = await createMeeting(owner.token)
    const otherMeetingId = await createMeeting(owner.token)
    const file = await upload(owner.token, meetingId)

    // Владелец тот же, но файл ищется по паре (файл, встреча): id из чужого
    // пути не удаляет файл, который лежит в другой встрече.
    const response = await deleteJson(filePath(otherMeetingId, file.id), owner.token)

    expect(response.status).toBe(404)
    expect(storedFiles(meetingId)).toEqual([`${file.id}.txt`])
  })

  it('файл чужой встречи → 404, и файл остаётся', async () => {
    const owner = await registerUser()
    const stranger = await registerUser()
    const meetingId = await createMeeting(owner.token)
    const file = await upload(owner.token, meetingId)

    const response = await deleteJson(filePath(meetingId, file.id), stranger.token)

    expect(response.status).toBe(404)
    expect(response.body).toEqual({ message: 'Meeting not found' })
    expect(storedFiles(meetingId)).toEqual([`${file.id}.txt`])
  })

  it('освобождает место: после удаления 20-го файла 21-й принимается', async () => {
    const owner = await registerUser()
    const meetingId = await createMeeting(owner.token)
    const files = []

    for (let index = 1; index <= 20; index += 1) {
      files.push(await upload(owner.token, meetingId, `заметка ${index}.txt`))
    }

    const last = files.at(-1)

    await deleteJson(filePath(meetingId, last?.id ?? ''), owner.token)

    const response = await postFile(
      filesPath(meetingId),
      { name: 'на освободившееся место.txt', type: 'text/plain', body: 'новый' },
      owner.token,
    )

    expect(response.status).toBe(201)
  })
})

describe('removeMeetingFiles', () => {
  // Роута удаления встречи нет, поэтому уборка проверяется напрямую: так её
  // будет звать будущий `DELETE /meetings/:id` — после удаления строки.
  it('удаление встречи и её каталога не оставляет следов ни в базе, ни на диске', async () => {
    const owner = await registerUser()
    const meetingId = await createMeeting(owner.token)

    await upload(owner.token, meetingId, 'первый.txt')
    await upload(owner.token, meetingId, 'второй.txt')

    // След прерванной загрузки, после которой упал процесс: строки в базе у
    // него нет, и подобрать его может только уборка каталога целиком.
    writeFileSync(join(meetingDir(meetingId), `${randomUUID()}.pdf.part`), 'недописано')

    await prisma.meeting.delete({ where: { id: meetingId } })
    await removeMeetingFiles(meetingId)

    expect(existsSync(meetingDir(meetingId))).toBe(false)
    // Строки файлов ушли каскадом вместе со встречей.
    expect(await prisma.meetingFile.count({ where: { meetingId } })).toBe(0)
  })

  it('идемпотентна: каталога уже нет — не ошибка', async () => {
    const owner = await registerUser()
    const meetingId = await createMeeting(owner.token)

    await removeMeetingFiles(meetingId)
    await removeMeetingFiles(meetingId)

    expect(existsSync(meetingDir(meetingId))).toBe(false)
  })

  // Пустой или кривой id превратился бы в `rm -rf UPLOAD_DIR` или выше.
  for (const meetingId of ['', '.', '..', '../..']) {
    it(`отказывается убирать «${meetingId}» — это не каталог встречи`, async () => {
      await expect(removeMeetingFiles(meetingId)).rejects.toThrow()
    })
  }
})
