import { existsSync } from 'node:fs'

import { describe, expect, it } from 'bun:test'

import { prisma } from '../src/db/prisma'
import {
  MAX_CONCURRENT_UPLOADS,
  STORAGE_QUOTA,
  STORAGE_QUOTA_EXCEEDED,
  TOO_MANY_UPLOADS,
} from '../src/modules/files/limits'
import { MAX_MEETINGS_PER_USER, TOO_MANY_MEETINGS } from '../src/modules/meetings'
import {
  asFile,
  createMeeting,
  filesPath,
  meetingDir,
  messageOf,
  storedFiles,
} from './helpers/files'
import { postFile, postJson } from './helpers/http'
import { decodeJwt } from './helpers/jwt'
import { waitForLockWaiter } from './helpers/locks'
import { registerUser } from './helpers/users'

/**
 * Потолки на пользователя. Регистрация открыта, почта не подтверждается, и без
 * них скрипт заводил бы встречи по 20 файлов × 2 ГБ, пока не кончится диск, —
 * а вместе с ним падали бы api и Postgres.
 *
 * 20 ГБ загрузкой в тесте не набрать, поэтому занятое место изображают строки
 * в базе без файлов на диске: квота считается по `size` в `meeting_files`,
 * а не по диску.
 */

const userIdOf = (token: string): string => String(decodeJwt(token).payload.sub)

/** Строка файла без файла на диске — «занятые» байты для квоты. */
const occupy = async (meetingId: string, bytes: number) =>
  prisma.meetingFile.create({
    data: {
      name: 'занято.mp4',
      size: BigInt(bytes),
      mimeType: 'video/mp4',
      kind: 'recording',
      path: `${meetingId}/занято.mp4`,
      meetingId,
    },
  })

/** Владелец с двумя встречами: в первой «занято» почти всё, во вторую грузим. */
const ownerNearQuota = async (free: number) => {
  const owner = await registerUser()
  const fullMeetingId = await createMeeting(owner.token)
  const meetingId = await createMeeting(owner.token)

  await occupy(fullMeetingId, STORAGE_QUOTA - free)

  return { owner, meetingId }
}

const text = (size: number, declared = true) => ({
  name: 'заметки.txt',
  type: 'text/plain',
  body: new Uint8Array(size),
  ...(declared ? { declaredSize: size } : {}),
})

describe('Квота места на пользователя', () => {
  it('заявленный размер не влезает → 409 с текстом, до записи: каталог не создан', async () => {
    const { owner, meetingId } = await ownerNearQuota(10)

    const response = await postFile(filesPath(meetingId), text(100), owner.token)

    expect(response.status).toBe(409)
    expect(messageOf(response)).toBe(STORAGE_QUOTA_EXCEEDED)
    expect(existsSync(meetingDir(meetingId))).toBe(false)
  })

  it('без Content-Length решает вставка: 409, а .part удалён', async () => {
    const { owner, meetingId } = await ownerNearQuota(10)

    const response = await postFile(filesPath(meetingId), text(100, false), owner.token)

    expect(response.status).toBe(409)
    expect(storedFiles(meetingId)).toEqual([])
  })

  it('ровно до квоты — принимается', async () => {
    const { owner, meetingId } = await ownerNearQuota(100)

    const response = await postFile(filesPath(meetingId), text(100), owner.token)

    expect(response.status).toBe(201)
  })

  it('квота своя у каждого: чужое место не в счёт', async () => {
    await ownerNearQuota(0)
    const neighbour = await registerUser()
    const meetingId = await createMeeting(neighbour.token)

    expect((await postFile(filesPath(meetingId), text(100), neighbour.token)).status).toBe(201)
  })

  /**
   * Гонка за последние байты квоты — тем же приёмом, что гонка на 21-й файл в
   * `files.e2e.test.ts`. Сосед держит замок на строке пользователя с уже
   * вставленным файлом, который съедает остаток. Загрузка проходит проверку до
   * записи (сосед ещё не закоммитил), пишет тело и встаёт в очередь за замком;
   * после коммита она видит занятое место и получает 409. Без замка на
   * пользователе она насчитала бы место до коммита соседа — и квота
   * превысилась бы: замок на встрече не спасает, файлы в разных встречах.
   */
  it('загрузка, ждущая соседа за последние байты, получает 409', async () => {
    const { owner, meetingId } = await ownerNearQuota(10)
    const otherMeetingId = await createMeeting(owner.token)
    const userId = userIdOf(owner.token)

    const { promise: lockTaken, resolve: takeLock } = Promise.withResolvers<void>()
    const { promise: released, resolve: release } = Promise.withResolvers<void>()

    const neighbour = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`
      await tx.meetingFile.create({
        data: {
          name: 'сосед.txt',
          size: 10n,
          mimeType: 'text/plain',
          kind: 'document',
          path: `${otherMeetingId}/сосед.txt`,
          meetingId: otherMeetingId,
        },
      })
      takeLock()
      await released
    })

    await lockTaken

    const upload = postFile(filesPath(meetingId), text(5), owner.token)

    await waitForLockWaiter()
    release()
    await neighbour

    const response = await upload

    expect(response.status).toBe(409)
    expect(messageOf(response)).toBe(STORAGE_QUOTA_EXCEEDED)
    expect(storedFiles(meetingId)).toEqual([])
  })
})

describe('Одновременные загрузки', () => {
  /** Тело, которое пришло наполовину и ждёт продолжения, — загрузка «в пути». */
  const pendingUpload = () => {
    let push = (_chunk: Uint8Array | null) => {}
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(10))
        push = (chunk) => (chunk === null ? controller.close() : controller.enqueue(chunk))
      },
    })

    return {
      file: { name: 'долгая.txt', type: 'text/plain', body, declaredSize: 20 },
      finish: () => {
        push(new Uint8Array(10))
        push(null)
      },
    }
  }

  const waitForParts = async (meetingId: string, count: number) => {
    for (let attempt = 0; attempt < 250; attempt += 1) {
      if (storedFiles(meetingId).filter((name) => name.endsWith('.part')).length >= count) {
        return
      }

      await Bun.sleep(20)
    }

    throw new Error(`Не дождались ${count} загрузок в пути`)
  }

  it(`${MAX_CONCURRENT_UPLOADS + 1}-я одновременная — 429; закончилась одна — снова можно`, async () => {
    const owner = await registerUser()
    const meetingId = await createMeeting(owner.token)
    const pending = Array.from({ length: MAX_CONCURRENT_UPLOADS }, pendingUpload)
    const inFlight = pending.map(({ file }) => postFile(filesPath(meetingId), file, owner.token))

    await waitForParts(meetingId, MAX_CONCURRENT_UPLOADS)

    const extra = await postFile(filesPath(meetingId), text(5), owner.token)

    expect(extra.status).toBe(429)
    expect(messageOf(extra)).toBe(TOO_MANY_UPLOADS)

    for (const { finish } of pending) {
      finish()
    }

    for (const response of await Promise.all(inFlight)) {
      expect(response.status).toBe(201)
    }

    // Счётчик вернулся: место освобождается и тогда, когда загрузка кончилась.
    expect((await postFile(filesPath(meetingId), text(5), owner.token)).status).toBe(201)
  })

  it('отказ посреди загрузки тоже освобождает место', async () => {
    const owner = await registerUser()
    const meetingId = await createMeeting(owner.token)

    // Тело короче заявленного — 400 уже после записи, когда место занято.
    // Раз за разом сверх потолка одновременных: не освобождай отказ место,
    // уже четвёртая получила бы 429.
    for (let attempt = 0; attempt < MAX_CONCURRENT_UPLOADS + 2; attempt += 1) {
      const response = await postFile(
        filesPath(meetingId),
        { name: 'обрезок.txt', type: 'text/plain', body: new Uint8Array(10), declaredSize: 20 },
        owner.token,
      )

      expect(response.status).toBe(400)
    }

    expect(asFile((await postFile(filesPath(meetingId), text(5), owner.token)).body).size).toBe(5)
  })
})

describe('Число встреч на пользователя', () => {
  it(`${MAX_MEETINGS_PER_USER}-я встреча создаётся, следующая — 409 с текстом`, async () => {
    const owner = await registerUser()
    const ownerId = userIdOf(owner.token)

    await prisma.meeting.createMany({
      data: Array.from({ length: MAX_MEETINGS_PER_USER - 1 }, (_, index) => ({
        title: `встреча ${index}`,
        date: new Date('2026-03-01T10:00:00.000Z'),
        participants: [],
        ownerId,
      })),
    })

    const payload = { title: 'Ещё одна', date: '2026-03-02T10:00:00.000Z', participants: [] }
    const last = await postJson('/meetings', payload, owner.token)
    const extra = await postJson('/meetings', payload, owner.token)

    expect(last.status).toBe(201)
    expect(extra.status).toBe(409)
    expect(messageOf(extra)).toBe(TOO_MANY_MEETINGS)
  })
})
