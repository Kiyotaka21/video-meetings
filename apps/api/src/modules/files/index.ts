import { mkdir, rename, unlink } from 'node:fs/promises'
import { extname, isAbsolute, join, relative } from 'node:path'

import { Elysia, t } from 'elysia'

import type { FileKind, FileStatus } from '../../../generated/prisma/enums'
import { env } from '../../config/env'
import { prisma } from '../../db/prisma'
import { authenticated } from '../auth'
import { acceptsDeclaredType, type FileFormat, FORMATS, SIZE_LIMITS } from './limits'

/**
 * Файлы встречи. Тело запроса не парсится (`parse: 'none'`) и уходит на диск
 * потоком: `request.formData()` в Bun собирает файл в память целиком, а PRD
 * прямо запрещает буферизацию — до 2 ГБ на файл.
 *
 * Имя и тип приходят заголовками, путь на диске генерирует сервер. Подробности
 * замеров — в `docs/research-meeting-file-upload.md`, читать до правок здесь.
 */

const fileResponse = t.Object({
  id: t.String(),
  name: t.String(),
  size: t.Number(),
  mimeType: t.String(),
  kind: t.Union([t.Literal('recording'), t.Literal('document')]),
  status: t.Union([
    t.Literal('uploaded'),
    t.Literal('processing'),
    t.Literal('ready'),
    t.Literal('failed'),
  ]),
  createdAt: t.String(),
})

const messageResponse = t.Object({ message: t.String() })

/** Тот же ответ, что и у `GET /meetings/:id`: чужая встреча неотличима от несуществующей. */
const MEETING_NOT_FOUND = { message: 'Meeting not found' } as const

/** Путь на диске наружу не уходит: он внутреннее дело api и зависит от машины. */
const publicFields = {
  id: true,
  name: true,
  size: true,
  mimeType: true,
  kind: true,
  status: true,
  createdAt: true,
} as const

interface MeetingFileRow {
  id: string
  name: string
  size: bigint
  mimeType: string
  kind: FileKind
  status: FileStatus
  createdAt: Date
}

const toResponse = (file: MeetingFileRow) => ({
  ...file,
  // BigInt не сериализуется в JSON: без Number ответ падает пятисоткой
  // «JSON.stringify cannot serialize BigInt». В базе тип остаётся BigInt —
  // максимум Int в Postgres на байт меньше двух гигабайт.
  size: Number(file.size),
  createdAt: file.createdAt.toISOString(),
})

const MAX_NAME_LENGTH = 255

/**
 * Имя приезжает percent-encoded: значение HTTP-заголовка — это байты Latin-1, и
 * кириллица в него не помещается ни на клиенте, ни на сервере (обе стороны
 * бросают исключение). Контракт — `encodeURIComponent` в браузере и разбор тут.
 *
 * `null` вместо исключения: битая строка (`%zz`, одиночный `%`) — ошибка
 * клиента, то есть 400, а не 500.
 */
const decodeFileName = (header: string | undefined): string | null => {
  if (!header) {
    return null
  }

  let decoded: string

  try {
    decoded = decodeURIComponent(header)
  } catch {
    return null
  }

  const name = decoded.trim()

  return name.length > 0 && name.length <= MAX_NAME_LENGTH ? name : null
}

type FormatCheck =
  { ok: true; extension: string; format: FileFormat } | { ok: false; message: string }

/** Расширение, которое не стыдно повторить в тексте отказа: без мусора из заголовка. */
const PRINTABLE_EXTENSION = /^\.[a-z0-9]{1,16}$/

const unsupportedFormat = (extension: string): string => {
  if (extension === '') {
    return 'Файлы без расширения не поддерживаются'
  }

  return PRINTABLE_EXTENSION.test(extension)
    ? `Формат ${extension} не поддерживается`
    : 'Формат файла не поддерживается'
}

/**
 * Формат по имени и заявленному типу. Расширение решает, тип только
 * подтверждает (ресерч, раздел 2.5):
 *
 * 1. расширения нет в таблице — отказ;
 * 2. тип пустой или octet-stream — судим по одному расширению;
 * 3. тип непустой и не из списка расширения — отказ.
 *
 * Буквальное «расширение или тип вне списков» отбило бы честный `.m4a` из Chrome
 * на Windows: тип там берётся из реестра ОС и для таких расширений часто пуст.
 */
const checkFormat = (name: string, contentType: string | undefined): FormatCheck => {
  // `extname('../../etc/passwd')` и `extname('.bashrc')` дают пустую строку:
  // ведущая точка расширением не считается, каталоги — тем более.
  const extension = extname(name).toLowerCase()
  const format = FORMATS.get(extension)

  if (!format) {
    return { ok: false, message: unsupportedFormat(extension) }
  }

  // Параметры (`; charset=`, `; codecs=`) к формату отношения не имеют.
  const declared = contentType?.split(';')[0]?.trim().toLowerCase() ?? ''

  if (!acceptsDeclaredType(format, declared)) {
    return { ok: false, message: `Заявленный тип файла не соответствует формату ${extension}` }
  }

  return { ok: true, extension, format }
}

/** 1 МиБ: столько же, сколько в замере памяти из ресерча. */
const HIGH_WATER_MARK = 1024 * 1024

/**
 * Пишет тело запроса в `.part` и возвращает число записанных байт — или `null`,
 * если тело вышло за `maxSize`. Тогда `.part` уже удалён.
 *
 * Файл публикуется переименованием уже после вставки строки в базу, поэтому
 * недописанного файла читатель не видит никогда: пока он пишется, его имени нет
 * ни в одной строке.
 */
const writeBody = async (
  body: ReadableStream<Uint8Array> | null,
  partPath: string,
  maxSize: number,
): Promise<number | null> => {
  const writer = Bun.file(partPath).writer({ highWaterMark: HIGH_WATER_MARK })
  let size = 0
  let tooLarge = false

  try {
    if (body) {
      for await (const chunk of body) {
        size += chunk.byteLength

        // Счётчик обязателен и при проверенном `Content-Length`: заголовок
        // присылает клиент, и он может соврать или не прислать его вовсе.
        // Лишний чанк на диск не уходит, а выход из цикла отменяет поток —
        // остаток тела не читается.
        if (size > maxSize) {
          tooLarge = true
          break
        }

        // `await` обязателен, и это не стилистика: `write` возвращает промис,
        // когда запись отложена, и без ожидания цикл читает сокет быстрее, чем
        // пишет диск. Замер на файле 1 ГБ: +6 МБ RSS с `await` против +2423 МБ
        // без него. Ни типы, ни тесты на мелких файлах разницы не увидят.
        await writer.write(chunk)
      }
    }

    await writer.end()
  } catch (error) {
    // Клиент нажал «Отменить» или потерял сеть: цикл бросает AbortError.
    // Недописанный `.part` — наш мусор, убрать его больше некому.
    await writer.end()
    await unlink(partPath).catch(() => {})

    throw error
  }

  if (tooLarge) {
    await unlink(partPath).catch(() => {})

    return null
  }

  return size
}

/**
 * Путь собирается из проверенного id встречи, сгенерированного id файла и
 * ключа таблицы форматов, так что `../` из имени сюда не доедет по построению.
 * Проверка всё равно стоит: она переживёт правку, которая решит подставить в
 * путь что-нибудь пользовательское.
 */
const isInsideUploadDir = (target: string): boolean => {
  const inside = relative(env.uploadDir, target)

  return inside.length > 0 && !inside.startsWith('..') && !isAbsolute(inside)
}

const security = [{ bearerAuth: [] }]

export const filesModule = new Elysia({ prefix: '/meetings', tags: ['Files'] })
  .use(authenticated)
  .post(
    '/:id/files',
    async ({ params, request, headers, userId, status }) => {
      // Владелец в `where`, а не проверка после выборки: чужая встреча не
      // находится вовсе и отвечает тем же 404, что и несуществующая.
      const meeting = await prisma.meeting.findFirst({
        where: { id: params.id, ownerId: userId },
        select: { id: true },
      })

      if (!meeting) {
        return status(404, MEETING_NOT_FOUND)
      }

      const name = decodeFileName(headers['x-file-name'])

      if (name === null) {
        return status(400, { message: 'Invalid or missing X-File-Name header' })
      }

      // До открытия файла на запись: отказ по формату не должен стоить ни
      // каталога на диске, ни прочитанного байта тела.
      const checked = checkFormat(name, headers['content-type'])

      if (!checked.ok) {
        return status(415, { message: checked.message })
      }

      const { extension, format } = checked
      const { maxSize, tooLarge } = SIZE_LIMITS[format.kind]

      // Основной рубеж — заявленный размер: браузер всегда шлёт
      // `Content-Length` у файла в теле XHR, и только отказ до чтения тела
      // гарантированно доезжает до клиента. 413 посреди чтения рвёт соединение,
      // и часть клиентов увидит обрыв вместо ответа. Заголовка нет или он не
      // число — `NaN > maxSize` ложно, и судит счётчик в потоке.
      if (Number(headers['content-length']) > maxSize) {
        return status(413, { message: tooLarge })
      }

      const id = Bun.randomUUIDv7()
      const directory = join(env.uploadDir, meeting.id)
      const destination = join(directory, `${id}${extension}`)

      if (!isInsideUploadDir(destination)) {
        throw new Error(`Путь файла вышел за пределы UPLOAD_DIR: ${destination}`)
      }

      // FileSink родительский каталог не создаёт — без mkdir первая же запись
      // во встречу падает с ENOENT.
      await mkdir(directory, { recursive: true })

      const partPath = `${destination}.part`
      const size = await writeBody(request.body, partPath, maxSize)

      if (size === null) {
        return status(413, { message: tooLarge })
      }

      try {
        const file = await prisma.meetingFile.create({
          data: {
            id,
            name,
            size: BigInt(size),
            // Тип формата, а не заявленный: заявленный только проверен выше.
            mimeType: format.mimeType,
            kind: format.kind,
            // Путь относительный и всегда со слэшем: переезд каталога загрузок
            // на другую машину не должен переписывать все строки разом.
            path: `${meeting.id}/${id}${extension}`,
            meetingId: meeting.id,
          },
          select: publicFields,
        })

        await rename(partPath, destination)

        return status(201, toResponse(file))
      } catch (error) {
        await unlink(partPath).catch(() => {})

        throw error
      }
    },
    {
      // Тело не парсится: `request.body` остаётся нетронутым потоком, который
      // обработчик сам сливает на диск. Схемы `body` тут быть не может.
      parse: 'none',
      params: t.Object({ id: t.String() }),
      response: {
        201: fileResponse,
        400: messageResponse,
        401: messageResponse,
        404: messageResponse,
        413: messageResponse,
        415: messageResponse,
      },
      detail: { summary: 'Upload a file to a meeting', security },
    },
  )
  .get(
    '/:id/files',
    async ({ params, userId, status }) => {
      const meeting = await prisma.meeting.findFirst({
        where: { id: params.id, ownerId: userId },
        select: { id: true },
      })

      if (!meeting) {
        return status(404, MEETING_NOT_FOUND)
      }

      const files = await prisma.meetingFile.findMany({
        where: { meetingId: meeting.id },
        // `created_at` в Postgres хранится с точностью до миллисекунды, и две
        // загрузки подряд в неё укладываются: без `id` вторым ключом порядок
        // одинаковых меток не определён. Id — uuid v7, то есть по времени.
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: publicFields,
      })

      return files.map(toResponse)
    },
    {
      params: t.Object({ id: t.String() }),
      response: {
        200: t.Array(fileResponse),
        401: messageResponse,
        404: messageResponse,
      },
      detail: { summary: 'List files of a meeting', security },
    },
  )
