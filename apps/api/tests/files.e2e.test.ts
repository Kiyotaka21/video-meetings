import { randomUUID } from 'node:crypto'
import { existsSync, readdirSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { describe, expect, it } from 'bun:test'

import { prisma } from '../src/db/prisma'
import {
  FORMATS,
  MAX_DOCUMENT_SIZE,
  MAX_FILES_PER_MEETING,
  SIZE_LIMITS,
} from '../src/modules/files/limits'
import {
  asFile,
  asFiles,
  createMeeting,
  filesPath,
  meetingDir,
  type MeetingFile,
  messageOf,
  storedFiles,
} from './helpers/files'
import { getJson, postFile, request, type ApiResponse } from './helpers/http'
import { registerUser } from './helpers/users'

/**
 * Контракт файлов встречи, e2e через `app.handle`. Оба маршрута — под
 * авторизацией и под владельцем: чужая встреча отвечает тем же 404, что и
 * несуществующая, иначе ответ подтверждал бы, что она есть.
 *
 * Требует поднятой базы с накатанной схемой: `bun run db:up && bun run db:migrate`.
 * Файлы пишутся во временный каталог из `tests/setup.ts`, не в рабочий `.uploads`.
 */

const DOCUMENT_TEXT = 'Итоги квартала: договорились созвониться ещё раз.'
const DOCUMENT_SIZE = new TextEncoder().encode(DOCUMENT_TEXT).byteLength

const document = (name = 'Отчёт за квартал.pdf') => ({
  name,
  type: 'application/pdf',
  body: DOCUMENT_TEXT,
})

/**
 * Ждёт, пока какой-нибудь запрос в нашей базе встанет в очередь за замком.
 * Опрашиваем `pg_stat_activity`, а не спим наугад: на медленной машине «100 мс»
 * не хватит, и тест на гонку молча перестанет её проверять. Тестовые файлы
 * `bun test` гоняет по очереди, так что чужих ожидающих здесь не бывает.
 */
const waitForLockWaiter = async (): Promise<void> => {
  for (let attempt = 0; attempt < 250; attempt += 1) {
    const [row] = await prisma.$queryRaw<Array<{ waiting: number }>>`
      SELECT count(*)::int AS waiting FROM pg_stat_activity
      WHERE wait_event_type = 'Lock' AND datname = current_database()`

    if ((row?.waiting ?? 0) > 0) {
      return
    }

    await Bun.sleep(20)
  }

  throw new Error('Загрузка так и не встала в очередь за замком на встрече')
}

const uploadDocument = async (meetingId: string, token: string, name?: string) =>
  asFile((await postFile(filesPath(meetingId), document(name), token)).body)

describe('Авторизация на /meetings/:id/files', () => {
  /** Каждый маршрут проверяется отдельно: забыть guard легко именно на одном из них. */
  const routes: Array<[string, (meetingId: string, token?: string) => Promise<ApiResponse>]> = [
    [
      'POST /meetings/:id/files',
      (meetingId, token) => postFile(filesPath(meetingId), document(), token),
    ],
    ['GET /meetings/:id/files', (meetingId, token) => getJson(filesPath(meetingId), token)],
  ]

  for (const [name, call] of routes) {
    it(`${name} без заголовка Authorization → 401`, async () => {
      const owner = await registerUser()
      const meetingId = await createMeeting(owner.token)

      const response = await call(meetingId)

      expect(response.status).toBe(401)
      expect(response.body).not.toHaveProperty('name')
    })

    it(`${name} с негодным токеном → 401`, async () => {
      const owner = await registerUser()
      const meetingId = await createMeeting(owner.token)

      const response = await call(meetingId, 'not-a-jwt-at-all')

      expect(response.status).toBe(401)
    })

    it(`${name} на чужую встречу → 404`, async () => {
      const owner = await registerUser()
      const stranger = await registerUser()
      const meetingId = await createMeeting(owner.token)

      const response = await call(meetingId, stranger.token)

      expect(response.status).toBe(404)
      // Ровно то же тело, что и у несуществующей встречи: иначе ответ
      // подтверждал бы, что встреча есть, просто чужая.
      expect(response.body).toEqual({ message: 'Meeting not found' })
    })

    it(`${name} на несуществующую встречу → 404`, async () => {
      const owner = await registerUser()

      const response = await call(randomUUID(), owner.token)

      expect(response.status).toBe(404)
    })
  }
})

describe('POST /meetings/:id/files', () => {
  it('отвечает 201 и метаданными загруженного документа', async () => {
    const owner = await registerUser()
    const meetingId = await createMeeting(owner.token)

    const response = await postFile(filesPath(meetingId), document(), owner.token)

    expect(response.status).toBe(201)

    const file = asFile(response.body)

    expect(file.name).toBe('Отчёт за квартал.pdf')
    expect(file.mimeType).toBe('application/pdf')
    expect(file.kind).toBe('document')
    expect(file.status).toBe('uploaded')
    expect(file.size).toBe(DOCUMENT_SIZE)
    // Дата — ISO-8601 в UTC, как у /meetings: клиенту не приходится гадать.
    expect(file.createdAt).toBe(new Date(file.createdAt).toISOString())
  })

  it('отдаёт размер числом: BigInt в ответе роняет сериализацию', async () => {
    const owner = await registerUser()
    const meetingId = await createMeeting(owner.token)

    const response = await postFile(filesPath(meetingId), document(), owner.token)

    expect(typeof asFile(response.body).size).toBe('number')
    expect(response.raw).toContain(`"size":${DOCUMENT_SIZE}`)
  })

  it('кладёт файл в каталог встречи под сгенерированным именем, байт в байт', async () => {
    const owner = await registerUser()
    const meetingId = await createMeeting(owner.token)

    const file = await uploadDocument(meetingId, owner.token)

    // Путь — `<UPLOAD_DIR>/<id встречи>/<id файла><расширение>`: исходное имя
    // живёт только в метаданных, в путь оно не попадает вовсе.
    const stored = join(meetingDir(meetingId), `${file.id}.pdf`)

    expect(await readFile(stored, 'utf8')).toBe(DOCUMENT_TEXT)
    // Пока файл пишется, он лежит под `.part` — и переименовывается только
    // после вставки строки. Успешная загрузка не оставляет такого хвоста.
    expect(readdirSync(meetingDir(meetingId))).toEqual([`${file.id}.pdf`])
  })

  it('сохраняет исходное имя с кириллицей и пробелами', async () => {
    const owner = await registerUser()
    const meetingId = await createMeeting(owner.token)
    const name = 'Запись планёрки 12 сентября.mp4'

    const response = await postFile(
      filesPath(meetingId),
      { name, type: 'video/mp4', body: 'кадры' },
      owner.token,
    )

    expect(asFile(response.body).name).toBe(name)
  })

  it('относит видео и аудио к записям, остальное — к документам', async () => {
    const owner = await registerUser()
    const meetingId = await createMeeting(owner.token)

    const recording = await postFile(
      filesPath(meetingId),
      { name: 'planning.mp4', type: 'video/mp4', body: 'кадры' },
      owner.token,
    )
    const notes = await postFile(
      filesPath(meetingId),
      { name: 'notes.md', type: 'text/markdown', body: '# Заметки' },
      owner.token,
    )

    expect(asFile(recording.body).kind).toBe('recording')
    expect(asFile(notes.body).kind).toBe('document')
  })

  it('принимает файл без заголовка Content-Type и пишет тип его формата', async () => {
    const owner = await registerUser()
    const meetingId = await createMeeting(owner.token)

    const response = await postFile(
      filesPath(meetingId),
      { name: 'notes.txt', body: 'без типа' },
      owner.token,
    )

    expect(response.status).toBe(201)
    expect(asFile(response.body).mimeType).toBe('text/plain')
  })

  it('без заголовка с именем → 400', async () => {
    const owner = await registerUser()
    const meetingId = await createMeeting(owner.token)

    const response = await request(filesPath(meetingId), {
      method: 'POST',
      headers: { authorization: `Bearer ${owner.token}` },
      body: 'файл без имени',
    })

    expect(response.status).toBe(400)
    expect(storedFiles(meetingId)).toEqual([])
  })

  it('битое percent-кодирование в имени → 400, а не 500', async () => {
    const owner = await registerUser()
    const meetingId = await createMeeting(owner.token)

    const response = await request(filesPath(meetingId), {
      method: 'POST',
      // `decodeURIComponent('%zz')` бросает URIError — это ошибка клиента.
      headers: { authorization: `Bearer ${owner.token}`, 'x-file-name': '%zz' },
      body: 'битое имя',
    })

    expect(response.status).toBe(400)
    expect(storedFiles(meetingId)).toEqual([])
  })

  it('на чужую встречу не создаёт каталог на диске', async () => {
    const owner = await registerUser()
    const stranger = await registerUser()
    const meetingId = await createMeeting(owner.token)

    const response = await postFile(filesPath(meetingId), document(), stranger.token)

    expect(response.status).toBe(404)
    expect(() => readdirSync(meetingDir(meetingId))).toThrow()
  })
})

describe('Форматы: 415 на всё, чего нет в таблице', () => {
  it('.zip → 415 с текстом про формат, а на диске ничего', async () => {
    const owner = await registerUser()
    const meetingId = await createMeeting(owner.token)

    const response = await postFile(
      filesPath(meetingId),
      { name: 'архив встречи.zip', type: 'application/zip', body: 'PK' },
      owner.token,
    )

    expect(response.status).toBe(415)
    // Текст уходит пользователю как есть — фронтенд показывает его в отказе.
    expect(messageOf(response)).toBe('Формат .zip не поддерживается')
    expect(storedFiles(meetingId)).toEqual([])
  })

  it('.exe → 415', async () => {
    const owner = await registerUser()
    const meetingId = await createMeeting(owner.token)

    const response = await postFile(
      filesPath(meetingId),
      { name: 'setup.exe', type: 'application/x-msdownload', body: 'MZ' },
      owner.token,
    )

    expect(response.status).toBe(415)
    expect(storedFiles(meetingId)).toEqual([])
  })

  it('файл без расширения → 415', async () => {
    const owner = await registerUser()
    const meetingId = await createMeeting(owner.token)

    const response = await postFile(
      filesPath(meetingId),
      { name: 'README', type: 'text/plain', body: 'без расширения' },
      owner.token,
    )

    expect(response.status).toBe(415)
    expect(storedFiles(meetingId)).toEqual([])
  })

  it('заявленный тип вне списка своего расширения → 415: .pdf как text/html', async () => {
    const owner = await registerUser()
    const meetingId = await createMeeting(owner.token)

    // Подмена типа: такой файл при отдаче уехал бы HTML'ем с origin'а api.
    const response = await postFile(
      filesPath(meetingId),
      { name: 'отчёт.pdf', type: 'text/html', body: '<script>alert(1)</script>' },
      owner.token,
    )

    expect(response.status).toBe(415)
    expect(messageOf(response)).toContain('.pdf')
    expect(storedFiles(meetingId)).toEqual([])
  })

  it('расширение сравнивается без учёта регистра: .PDF ложится на диск как .pdf', async () => {
    const owner = await registerUser()
    const meetingId = await createMeeting(owner.token)

    const response = await postFile(
      filesPath(meetingId),
      { name: 'СКАН.PDF', type: 'application/pdf', body: '%PDF' },
      owner.token,
    )

    expect(response.status).toBe(201)

    const file = asFile(response.body)

    expect(file.name).toBe('СКАН.PDF')
    expect(storedFiles(meetingId)).toEqual([`${file.id}.pdf`])
  })

  // Браузер берёт тип из реестра ОС, и на Windows для .m4a и .webm его там
  // сплошь и рядом нет: приезжает пустая строка или octet-stream. Отбить такой
  // файл — значит сломать честную загрузку на пустом месте.
  for (const declared of [undefined, '', 'application/octet-stream']) {
    it(`тип «${declared ?? 'нет заголовка'}» у .m4a не мешает: в метаданных тип формата`, async () => {
      const owner = await registerUser()
      const meetingId = await createMeeting(owner.token)

      const response = await postFile(
        filesPath(meetingId),
        { name: 'созвон.m4a', type: declared, body: 'звук' },
        owner.token,
      )

      expect(response.status).toBe(201)
      expect(asFile(response.body).mimeType).toBe('audio/mp4')
      expect(asFile(response.body).kind).toBe('recording')
    })
  }

  it('в метаданные уходит тип формата, а не заявленный: .m4a как audio/x-m4a', async () => {
    const owner = await registerUser()
    const meetingId = await createMeeting(owner.token)

    const response = await postFile(
      filesPath(meetingId),
      { name: 'созвон.m4a', type: 'audio/x-m4a; codecs=mp4a.40.2', body: 'звук' },
      owner.token,
    )

    expect(response.status).toBe(201)
    expect(asFile(response.body).mimeType).toBe('audio/mp4')
  })

  it('CSV с типом от Excel на Windows принимается', async () => {
    const owner = await registerUser()
    const meetingId = await createMeeting(owner.token)

    // Установленный Excel перехватывает .csv в реестре, и браузер шлёт его тип.
    const response = await postFile(
      filesPath(meetingId),
      { name: 'участники.csv', type: 'application/vnd.ms-excel', body: 'email\n' },
      owner.token,
    )

    expect(response.status).toBe(201)
    expect(asFile(response.body).mimeType).toBe('text/csv')
  })

  it('таблица форматов — ровно список из PRD, по группам', () => {
    const extensionsOf = (kind: string) =>
      [...FORMATS]
        .filter(([, format]) => format.kind === kind)
        .map(([extension]) => extension)
        .sort()

    expect(extensionsOf('recording')).toEqual(
      ['.m4a', '.mov', '.mp3', '.mp4', '.ogg', '.wav', '.webm'].sort(),
    )
    expect(extensionsOf('document')).toEqual(
      ['.csv', '.docx', '.md', '.pdf', '.pptx', '.txt', '.xlsx'].sort(),
    )
  })

  it('каждый формат из таблицы принимается со своим типом и своей группой', async () => {
    const owner = await registerUser()
    const meetingId = await createMeeting(owner.token)

    for (const [extension, format] of FORMATS) {
      const response = await postFile(
        filesPath(meetingId),
        { name: `файл${extension}`, type: format.mimeType, body: 'байты' },
        owner.token,
      )

      expect(response.status).toBe(201)
      expect(asFile(response.body).kind).toBe(format.kind)
      expect(asFile(response.body).mimeType).toBe(format.mimeType)
    }
  })
})

/**
 * Тело из `size` нулевых байт чанками по 1 МиБ: в памяти теста держится один
 * чанк, а не весь файл. Поток, а не строка, — так байты идут через тот же цикл
 * записи, что и у настоящей загрузки.
 */
const zeros = (size: number): ReadableStream<Uint8Array> => {
  const chunk = new Uint8Array(1024 * 1024)
  let left = size

  return new ReadableStream({
    pull(controller) {
      if (left === 0) {
        controller.close()

        return
      }

      const length = Math.min(left, chunk.byteLength)

      controller.enqueue(chunk.subarray(0, length))
      left -= length
    },
  })
}

describe('Размер: 413 по Content-Length и по факту записанных байт', () => {
  it('запись с заявленными 2.1 ГБ → 413 до чтения тела, на диске ничего', async () => {
    const owner = await registerUser()
    const meetingId = await createMeeting(owner.token)

    // Бьём по заголовку, а не гоним гигабайты через `app.handle`: отказ по
    // `Content-Length` обязан случиться раньше, чем прочитан первый байт.
    const response = await postFile(
      filesPath(meetingId),
      {
        name: 'планёрка.mp4',
        type: 'video/mp4',
        body: 'кадры',
        declaredSize: Math.round(2.1 * 1024 ** 3),
      },
      owner.token,
    )

    expect(response.status).toBe(413)
    expect(messageOf(response)).toBe(SIZE_LIMITS.recording.tooLarge)
    expect(storedFiles(meetingId)).toEqual([])
  })

  it('документ с заявленными 51 МБ → 413: у документа свой лимит', async () => {
    const owner = await registerUser()
    const meetingId = await createMeeting(owner.token)

    const response = await postFile(
      filesPath(meetingId),
      { ...document(), declaredSize: 51 * 1024 ** 2 },
      owner.token,
    )

    expect(response.status).toBe(413)
    expect(messageOf(response)).toBe(SIZE_LIMITS.document.tooLarge)
    expect(storedFiles(meetingId)).toEqual([])
  })

  it('лимит считается от группы: запись на 51 МБ лимит документа не задевает', async () => {
    const owner = await registerUser()
    const meetingId = await createMeeting(owner.token)

    const response = await postFile(
      filesPath(meetingId),
      { name: 'созвон.mp3', type: 'audio/mpeg', body: 'звук', declaredSize: 51 * 1024 ** 2 },
      owner.token,
    )

    expect(response.status).toBe(201)
  })

  it('документ ровно на лимит принимается: граница включительно', async () => {
    const owner = await registerUser()
    const meetingId = await createMeeting(owner.token)

    const response = await postFile(
      filesPath(meetingId),
      {
        name: 'протокол.pdf',
        type: 'application/pdf',
        body: zeros(MAX_DOCUMENT_SIZE),
        declaredSize: MAX_DOCUMENT_SIZE,
      },
      owner.token,
    )

    expect(response.status).toBe(201)
    expect(asFile(response.body).size).toBe(MAX_DOCUMENT_SIZE)
  })

  it('клиент соврал в Content-Length: 413 по счётчику, недописанный файл удалён', async () => {
    const owner = await registerUser()
    const meetingId = await createMeeting(owner.token)

    // Заголовок обещает 10 байт, тело несёт на байт больше лимита. Проверка
    // заголовка такого клиента пропускает — ловит только счётчик в потоке.
    const response = await postFile(
      filesPath(meetingId),
      {
        name: 'протокол.pdf',
        type: 'application/pdf',
        body: zeros(MAX_DOCUMENT_SIZE + 1),
        declaredSize: 10,
      },
      owner.token,
    )

    expect(response.status).toBe(413)
    expect(messageOf(response)).toBe(SIZE_LIMITS.document.tooLarge)
    // Каталог встречи к этому моменту уже создан, но `.part` в нём не осталось.
    expect(storedFiles(meetingId)).toEqual([])
    expect(asFiles((await getJson(filesPath(meetingId), owner.token)).body)).toEqual([])
  })

  it('без Content-Length судит тот же счётчик', async () => {
    const owner = await registerUser()
    const meetingId = await createMeeting(owner.token)

    const response = await postFile(
      filesPath(meetingId),
      { name: 'протокол.pdf', type: 'application/pdf', body: zeros(MAX_DOCUMENT_SIZE + 1) },
      owner.token,
    )

    expect(response.status).toBe(413)
    expect(storedFiles(meetingId)).toEqual([])
  })
})

describe(`Число файлов: 409 на ${MAX_FILES_PER_MEETING + 1}-й`, () => {
  const note = (index: number) => ({
    name: `заметка ${index}.txt`,
    type: 'text/plain',
    body: `заметка ${index}`,
  })

  /** Заполняет встречу мелкими файлами, по одному: порядок тут не важен, важен счёт. */
  const fill = async (meetingId: string, token: string, count: number) => {
    for (let index = 1; index <= count; index += 1) {
      const response = await postFile(filesPath(meetingId), note(index), token)

      expect(response.status).toBe(201)
    }
  }

  it('лишний файл → 409 с текстом про лимит, на диске только принятые', async () => {
    const owner = await registerUser()
    const meetingId = await createMeeting(owner.token)

    await fill(meetingId, owner.token, MAX_FILES_PER_MEETING)

    const response = await postFile(filesPath(meetingId), note(0), owner.token)

    expect(response.status).toBe(409)
    expect(messageOf(response)).toContain('лимит')
    expect(messageOf(response)).toContain(String(MAX_FILES_PER_MEETING))

    const listed = asFiles((await getJson(filesPath(meetingId), owner.token)).body)

    expect(listed).toHaveLength(MAX_FILES_PER_MEETING)
    // Ровно принятые файлы и ни одного `.part`: отказ не оставил следа на диске.
    expect(storedFiles(meetingId)).toEqual(listed.map((file) => `${file.id}.txt`).sort())
  })

  it('лимит считается на встречу: у соседней встречи того же владельца место есть', async () => {
    const owner = await registerUser()
    const fullMeetingId = await createMeeting(owner.token)
    const otherMeetingId = await createMeeting(owner.token)

    await fill(fullMeetingId, owner.token, MAX_FILES_PER_MEETING)

    const response = await postFile(filesPath(otherMeetingId), note(0), owner.token)

    expect(response.status).toBe(201)
  })

  /**
   * Гонка на последнее место, разыгранная детерминированно. «Пять загрузок
   * через `Promise.all`» её не ловит — проверено: через `app.handle` запросы
   * доходят до вставки вразнобой, окно не открывается, и такой тест зелёный и
   * без замка.
   *
   * Поэтому соседний запрос изображает сам тест: держит открытую транзакцию с
   * замком на встрече и уже вставленным двадцатым файлом, дожидается, пока
   * загрузка встанет в очередь за замком, и только тогда коммитит. С замком в
   * обработчике загрузка считает файлы после коммита и видит 20 — 409. Без него
   * она насчитала 19 ещё до коммита, а потом вставляет двадцать первый — 201.
   */
  it('загрузка, ждущая соседа на последнее место, получает 409, а не 21-й файл', async () => {
    const owner = await registerUser()
    const meetingId = await createMeeting(owner.token)

    await fill(meetingId, owner.token, MAX_FILES_PER_MEETING - 1)

    const { promise: lockTaken, resolve: takeLock } = Promise.withResolvers<void>()
    const { promise: released, resolve: release } = Promise.withResolvers<void>()

    const neighbour = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM meetings WHERE id = ${meetingId} FOR UPDATE`
      await tx.meetingFile.create({
        data: {
          name: 'сосед.txt',
          size: 1n,
          mimeType: 'text/plain',
          kind: 'document',
          path: `${meetingId}/сосед.txt`,
          meetingId,
        },
      })
      takeLock()
      await released
    })

    await lockTaken

    const upload = postFile(filesPath(meetingId), note(0), owner.token)

    await waitForLockWaiter()
    release()
    await neighbour

    const response = await upload

    expect(response.status).toBe(409)
    expect(asFiles((await getJson(filesPath(meetingId), owner.token)).body)).toHaveLength(
      MAX_FILES_PER_MEETING,
    )
    // Принятые 19 и ни одного `.part`: у «соседа» файла на диске нет вовсе.
    expect(storedFiles(meetingId)).toHaveLength(MAX_FILES_PER_MEETING - 1)
  })
})

describe('Имя файла не участвует в пути на диске', () => {
  // Голое `../../etc/passwd` расширения не имеет — `extname` даёт пустую строку,
  // — и отбивается форматом раньше, чем дело доходит до пути. Проверять, куда
  // ляжет файл, приходится на имени с разрешённым расширением.
  it('`../../etc/passwd` без расширения → 415, на диске ничего', async () => {
    const owner = await registerUser()
    const meetingId = await createMeeting(owner.token)

    const response = await postFile(
      filesPath(meetingId),
      { name: '../../etc/passwd', body: 'root:x:0:0' },
      owner.token,
    )

    expect(response.status).toBe(415)
    expect(storedFiles(meetingId)).toEqual([])
    expect(existsSync(resolve(meetingDir(meetingId), '../../etc'))).toBe(false)
  })

  for (const name of ['../../etc/passwd.txt', '..\\..\\etc\\passwd.txt']) {
    it(`«${name}» ложится внутрь каталога встречи, а в списке — исходным именем`, async () => {
      const owner = await registerUser()
      const meetingId = await createMeeting(owner.token)

      const response = await postFile(
        filesPath(meetingId),
        { name, type: 'text/plain', body: 'root:x:0:0' },
        owner.token,
      )

      expect(response.status).toBe(201)

      const file = asFile(response.body)

      // Путь — `<id встречи>/<id файла><расширение из таблицы>`: из имени в него
      // не доезжает ни один символ, поэтому и `../`, и `..\` тут бессильны.
      expect(storedFiles(meetingId)).toEqual([`${file.id}.txt`])
      expect(existsSync(resolve(meetingDir(meetingId), '../../etc'))).toBe(false)
      expect(existsSync(resolve(meetingDir(meetingId), '..\\..\\etc'))).toBe(false)

      const listed = asFiles((await getJson(filesPath(meetingId), owner.token)).body)

      expect(listed.map((item) => item.name)).toEqual([name])
    })
  }
})

describe('Обрыв посреди тела', () => {
  it('недописанный файл удаляется, строки в базе нет', async () => {
    const owner = await registerUser()
    const meetingId = await createMeeting(owner.token)

    // Так через `app.handle` выглядит клиент, который нажал «Отменить» или
    // потерял сеть: на живом сервере цикл чтения бросает `AbortError`.
    let sent = false
    const broken = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent) {
          controller.error(new Error('Соединение оборвалось'))

          return
        }

        sent = true
        controller.enqueue(new Uint8Array(64 * 1024))
      },
    })

    await postFile(
      filesPath(meetingId),
      { name: 'протокол.pdf', type: 'application/pdf', body: broken },
      owner.token,
    )

    // Код ответа на оборванный запрос никто не прочитает — важно, что на
    // диске и в базе от него ничего не осталось.
    expect(storedFiles(meetingId)).toEqual([])
    expect(asFiles((await getJson(filesPath(meetingId), owner.token)).body)).toEqual([])
  })
})

describe('GET /meetings/:id/files', () => {
  it('у встречи без файлов отдаёт пустой список', async () => {
    const owner = await registerUser()
    const meetingId = await createMeeting(owner.token)

    const response = await getJson(filesPath(meetingId), owner.token)

    expect(response.status).toBe(200)
    expect(asFiles(response.body)).toEqual([])
  })

  it('отдаёт файлы по дате загрузки и теми же полями, что и загрузка', async () => {
    const owner = await registerUser()
    const meetingId = await createMeeting(owner.token)

    const first = await uploadDocument(meetingId, owner.token, 'первый.pdf')
    const second = await uploadDocument(meetingId, owner.token, 'второй.pdf')

    const response = await getJson(filesPath(meetingId), owner.token)
    const files = asFiles(response.body)

    // Ссылка выписывается заново на каждый ответ: токен совпадёт, только если
    // оба ответа уложились в одну секунду `iat`, — поэтому сравнивается путь.
    const withLinkPath = ({ url, ...file }: MeetingFile) => ({
      ...file,
      url: new URL(url, 'http://localhost').pathname,
    })

    expect(response.status).toBe(200)
    expect(files.map(withLinkPath)).toEqual([first, second].map(withLinkPath))
  })

  it('файлы соседних встреч не смешиваются', async () => {
    const owner = await registerUser()
    const meetingId = await createMeeting(owner.token)
    const otherMeetingId = await createMeeting(owner.token)

    const uploaded = await uploadDocument(meetingId, owner.token)

    const own = asFiles((await getJson(filesPath(meetingId), owner.token)).body)
    const other = asFiles((await getJson(filesPath(otherMeetingId), owner.token)).body)

    expect(own.map((file) => file.id)).toEqual([uploaded.id])
    expect(other).toEqual([])
  })
})
