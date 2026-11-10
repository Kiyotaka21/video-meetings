import { mkdir, rename, unlink } from 'node:fs/promises'
import { extname } from 'node:path'

import { Elysia, t } from 'elysia'

import type { Prisma } from '../../../generated/prisma/client'
import type { FileKind, FileStatus } from '../../../generated/prisma/enums'
import { prisma } from '../../db/prisma'
import { isUuid } from '../../lib/ids'
import { BIDI_CONTROLS, CONTROL_CHARACTERS } from '../../lib/text'
import { authenticated } from '../auth'
import { fileContentRoutes } from './content'
import {
  acceptsDeclaredType,
  type FileFormat,
  FORMATS,
  MAX_CONCURRENT_UPLOADS,
  MAX_FILES_PER_MEETING,
  SIZE_LIMITS,
  STORAGE_QUOTA,
  STORAGE_QUOTA_EXCEEDED,
  TOO_MANY_FILES,
  TOO_MANY_UPLOADS,
} from './limits'
import { contentPath, fileLinkJwt } from './link'
import { meetingDirectory, removeStoredFile, storedPath, writeBody } from './storage'

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
  /**
   * Путь отдачи от корня api с файловым токеном в `?token=`. Не абсолютный
   * адрес: api не знает, под каким origin'ом его видит браузер, — фронтенд
   * склеивает путь со своим адресом api, как `$fetch` с `baseURL`.
   */
  url: t.String(),
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

/** `sign` файлового JWT-плагина: в контексте он появляется после `.use(fileLinkJwt)`. */
type SignLink = (payload: { sub: string }) => Promise<string>

/**
 * Ссылка выписывается в момент ответа и живёт `FILE_LINK_EXPIRES_IN`: страница,
 * открытая дольше, получит отказ плеера и перезапросит список.
 */
const toResponse = async (file: MeetingFileRow, meetingId: string, signLink: SignLink) => ({
  ...file,
  // BigInt не сериализуется в JSON: без Number ответ падает пятисоткой
  // «JSON.stringify cannot serialize BigInt». В базе тип остаётся BigInt —
  // максимум Int в Postgres на байт меньше двух гигабайт.
  size: Number(file.size),
  createdAt: file.createdAt.toISOString(),
  url: `${contentPath(meetingId, file.id)}?${new URLSearchParams({
    token: await signLink({ sub: file.id }),
  })}`,
})

const MAX_NAME_LENGTH = 255

/**
 * Чего не бывает в честном имени файла: управляющие символы и управление
 * направлением текста. NUL Postgres в тексте не принимает — вставка падала
 * пятисоткой уже после записи всего тела, — а bidi-символы подделывают видимое
 * имя в списке и у скачанного файла.
 */
const FORBIDDEN_IN_NAME = new RegExp(`[${CONTROL_CHARACTERS}${BIDI_CONTROLS}]`)

/**
 * Имя приезжает percent-encoded: значение HTTP-заголовка — это байты Latin-1, и
 * кириллица в него не помещается ни на клиенте, ни на сервере (обе стороны
 * бросают исключение). Контракт — `encodeURIComponent` в браузере и разбор тут.
 *
 * `null` вместо исключения: битая строка (`%zz`, одиночный `%`) и запрещённые
 * символы — ошибка клиента, то есть 400, а не 500. Проверка — до записи тела.
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

  if (FORBIDDEN_IN_NAME.test(decoded)) {
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

/** Сколько байт занимают файлы всех встреч пользователя — то, что меряет квота. */
const usedBytes = async (
  db: Pick<Prisma.TransactionClient, 'meetingFile'>,
  userId: string,
): Promise<bigint> => {
  const { _sum } = await db.meetingFile.aggregate({
    _sum: { size: true },
    where: { meeting: { ownerId: userId } },
  })

  return _sum.size ?? 0n
}

/**
 * Вставляет строку файла, если во встрече есть место и квота пользователя не
 * кончилась, — иначе отдаёт текст отказа.
 *
 * Одной транзакции мало (ресерч, 2.6): в Postgres по умолчанию READ COMMITTED, и
 * `count` внутри неё ничего не блокирует — два параллельных запроса оба насчитают
 * 19 и оба вставят двадцатый. Замки сериализуют их: второй ждёт на
 * `FOR UPDATE`, пока первый не закоммитит вставку, и уже видит её в своём
 * счёте. Замок на встрече — для числа файлов в ней, на пользователе — для
 * квоты: файлы одного человека лежат в разных встречах, и замок встречи гонку
 * за последние байты не остановил бы. Порядок — пользователь, потом встреча:
 * у всех, кто берёт оба, он один, иначе две загрузки сцепились бы намертво.
 * Тесты на обе гонки без своего замка краснеют — проверено.
 */
const createWithinLimits = (userId: string, data: Prisma.MeetingFileUncheckedCreateInput) =>
  prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`
    await tx.$queryRaw`SELECT id FROM meetings WHERE id = ${data.meetingId} FOR UPDATE`

    const count = await tx.meetingFile.count({ where: { meetingId: data.meetingId } })

    if (count >= MAX_FILES_PER_MEETING) {
      return { ok: false, message: TOO_MANY_FILES } as const
    }

    if ((await usedBytes(tx, userId)) + BigInt(data.size) > BigInt(STORAGE_QUOTA)) {
      return { ok: false, message: STORAGE_QUOTA_EXCEEDED } as const
    }

    return { ok: true, file: await tx.meetingFile.create({ data, select: publicFields }) } as const
  })

/**
 * Загрузки «в пути» по пользователям — в памяти процесса, как и счётчики
 * перебора в `auth.ts`: api — один процесс. Занимается до записи тела,
 * освобождается в `finally`, что бы с загрузкой ни случилось.
 */
const activeUploads = new Map<string, number>()

const startUpload = (userId: string): boolean => {
  const active = activeUploads.get(userId) ?? 0

  if (active >= MAX_CONCURRENT_UPLOADS) {
    return false
  }

  activeUploads.set(userId, active + 1)

  return true
}

const finishUpload = (userId: string): void => {
  const active = (activeUploads.get(userId) ?? 1) - 1

  if (active > 0) {
    activeUploads.set(userId, active)
  } else {
    activeUploads.delete(userId)
  }
}

/**
 * Владелец в `where`, а не проверка после выборки: чужая встреча не находится
 * вовсе и отвечает тем же 404, что и несуществующая. Id не в формате uuid до
 * базы не доходит (`isUuid`): `%00` в пути ронял запрос пятисоткой.
 */
const findOwnMeeting = async (meetingId: string, userId: string) =>
  isUuid(meetingId)
    ? prisma.meeting.findFirst({ where: { id: meetingId, ownerId: userId }, select: { id: true } })
    : null

/** P2025 — строка для `delete` не нашлась: файла нет или он в другой встрече. */
const isRecordNotFound = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2025'

const FILE_NOT_FOUND = { message: 'File not found' } as const

const security = [{ bearerAuth: [] }]

/**
 * Маршруты владельца — под `authenticated`. Отдача файла (`content.ts`) живёт в
 * своём инстансе рядом, а не дописана сюда: guard действует на всё, что внутри
 * инстанса, а ссылке для `<video>` прислать `Authorization` нечем.
 */
const ownerRoutes = new Elysia({ name: 'files.owner', prefix: '/meetings', tags: ['Files'] })
  .use(authenticated)
  .use(fileLinkJwt)
  .post(
    '/:id/files',
    async ({ params, request, headers, userId, fileJwt, status }) => {
      const meeting = await findOwnMeeting(params.id, userId)

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

      // Дешёвая отсечка до записи: без неё лишний файл на 2 ГБ сначала лёг бы
      // на диск целиком и только потом получил отказ. Окончательно решает счёт
      // при вставке — до неё место может занять соседний запрос.
      const filesSoFar = await prisma.meetingFile.count({ where: { meetingId: meeting.id } })

      if (filesSoFar >= MAX_FILES_PER_MEETING) {
        return status(409, { message: TOO_MANY_FILES })
      }

      // Квота — та же дешёвая отсечка по заявленному размеру: файл, который
      // заведомо не влезет, не пишется на диск ради отказа. Без заголовка
      // (chunked) решает вставка — по записанным байтам и под замком.
      const declared = Number(headers['content-length'])
      const incoming = Number.isFinite(declared) ? declared : 0

      if ((await usedBytes(prisma, userId)) + BigInt(incoming) > BigInt(STORAGE_QUOTA)) {
        return status(409, { message: STORAGE_QUOTA_EXCEEDED })
      }

      // Последним из проверок до записи: место «в пути» занимается только
      // загрузкой, которая действительно начнёт писать, и освобождается в
      // `finally` — после ответа, обрыва или исключения.
      if (!startUpload(userId)) {
        return status(429, { message: TOO_MANY_UPLOADS })
      }

      try {
        const id = Bun.randomUUIDv7()
        // Путь относительный и всегда со слэшем: переезд каталога загрузок на
        // другую машину не должен переписывать все строки разом.
        const relativePath = `${meeting.id}/${id}${extension}`
        const directory = meetingDirectory(meeting.id)
        const destination = storedPath(relativePath)

        // FileSink родительский каталог не создаёт — без mkdir первая же запись
        // во встречу падает с ENOENT.
        await mkdir(directory, { recursive: true })

        const partPath = `${destination}.part`
        const size = await writeBody(request.body, partPath, maxSize)

        if (size === null) {
          return status(413, { message: tooLarge })
        }

        // Тело короче собственного `Content-Length` — файл неполный, что бы ни
        // случилось с соединением. Обычно обрыв приходит `AbortError` из цикла
        // чтения, но замер в браузере оставил обрезок 85 МБ из 200 как готовый
        // файл: поток тела закончился без ошибки (ресерч, замер 20). Заголовка
        // нет (chunked) — сверять не с чем.
        const declaredSize = headers['content-length']

        if (declaredSize !== undefined && Number(declaredSize) !== size) {
          await unlink(partPath).catch(() => {})

          return status(400, { message: 'Файл пришёл не целиком — загрузите его ещё раз' })
        }

        try {
          const created = await createWithinLimits(userId, {
            id,
            name,
            size: BigInt(size),
            // Тип формата, а не заявленный: заявленный только проверен выше.
            mimeType: format.mimeType,
            kind: format.kind,
            path: relativePath,
            meetingId: meeting.id,
          })

          if (!created.ok) {
            await unlink(partPath).catch(() => {})

            return status(409, { message: created.message })
          }

          await rename(partPath, destination)

          return status(
            201,
            await toResponse(created.file, meeting.id, (payload) => fileJwt.sign(payload)),
          )
        } catch (error) {
          await unlink(partPath).catch(() => {})

          throw error
        }
      } finally {
        finishUpload(userId)
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
        409: messageResponse,
        413: messageResponse,
        415: messageResponse,
        429: messageResponse,
      },
      detail: { summary: 'Upload a file to a meeting', security },
    },
  )
  .get(
    '/:id/files',
    async ({ params, userId, fileJwt, status }) => {
      const meeting = await findOwnMeeting(params.id, userId)

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

      return Promise.all(
        files.map((file) => toResponse(file, meeting.id, (payload) => fileJwt.sign(payload))),
      )
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
  .delete(
    '/:id/files/:fileId',
    async ({ params, userId, status }) => {
      const meeting = await findOwnMeeting(params.id, userId)

      if (!meeting) {
        return status(404, MEETING_NOT_FOUND)
      }

      // Сначала строка, потом диск (ресерч, 6): файл без строки безвреден и
      // уйдёт вместе с каталогом встречи, а строка без файла — битая ссылка в
      // интерфейсе. Удаление по паре (файл, встреча) атомарно: из двух
      // одновременных запросов второй получит P2025, то есть 404, а не 500.
      let removed: { path: string }

      if (!isUuid(params.fileId)) {
        return status(404, FILE_NOT_FOUND)
      }

      try {
        removed = await prisma.meetingFile.delete({
          where: { id: params.fileId, meetingId: meeting.id },
          select: { path: true },
        })
      } catch (error) {
        if (isRecordNotFound(error)) {
          return status(404, FILE_NOT_FOUND)
        }

        throw error
      }

      // На Windows файл удаляется и тогда, когда его ещё отдают по ссылке, —
      // читатель дочитывает до конца (ресерч, замер 11). Новых читателей не
      // будет: отдача сначала ищет строку, а её уже нет.
      await removeStoredFile(removed.path)

      return status(204, undefined)
    },
    {
      params: t.Object({ id: t.String(), fileId: t.String() }),
      response: {
        204: t.Undefined(),
        401: messageResponse,
        404: messageResponse,
      },
      detail: { summary: 'Delete a file of a meeting', security },
    },
  )

export const filesModule = new Elysia().use(ownerRoutes).use(fileContentRoutes)
