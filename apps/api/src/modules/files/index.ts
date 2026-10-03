import { mkdir, rename, unlink } from 'node:fs/promises'
import { extname } from 'node:path'

import { Elysia, t } from 'elysia'

import type { Prisma } from '../../../generated/prisma/client'
import type { FileKind, FileStatus } from '../../../generated/prisma/enums'
import { prisma } from '../../db/prisma'
import { authenticated } from '../auth'
import { fileContentRoutes } from './content'
import {
  acceptsDeclaredType,
  type FileFormat,
  FORMATS,
  MAX_FILES_PER_MEETING,
  SIZE_LIMITS,
  TOO_MANY_FILES,
} from './limits'
import { contentPath, fileLinkJwt } from './link'
import { meetingDirectory, storedPath, writeBody } from './storage'

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

/**
 * Вставляет строку файла, если во встрече есть место, — иначе `null`.
 *
 * Одной транзакции мало (ресерч, 2.6): в Postgres по умолчанию READ COMMITTED, и
 * `count` внутри неё ничего не блокирует — два параллельных запроса оба насчитают
 * 19 и оба вставят двадцатый. Замок на строке встречи сериализует их: второй
 * ждёт на `FOR UPDATE`, пока первый не закоммитит вставку, и уже видит её в
 * своём счёте. Тест на гонку без замка краснеет — проверено.
 */
const createWithinLimit = (data: Prisma.MeetingFileUncheckedCreateInput) =>
  prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM meetings WHERE id = ${data.meetingId} FOR UPDATE`

    const count = await tx.meetingFile.count({ where: { meetingId: data.meetingId } })

    if (count >= MAX_FILES_PER_MEETING) {
      return null
    }

    return tx.meetingFile.create({ data, select: publicFields })
  })

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

      // Дешёвая отсечка до записи: без неё лишний файл на 2 ГБ сначала лёг бы
      // на диск целиком и только потом получил отказ. Окончательно решает счёт
      // при вставке — до неё место может занять соседний запрос.
      const filesSoFar = await prisma.meetingFile.count({ where: { meetingId: meeting.id } })

      if (filesSoFar >= MAX_FILES_PER_MEETING) {
        return status(409, { message: TOO_MANY_FILES })
      }

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

      try {
        const file = await createWithinLimit({
          id,
          name,
          size: BigInt(size),
          // Тип формата, а не заявленный: заявленный только проверен выше.
          mimeType: format.mimeType,
          kind: format.kind,
          path: relativePath,
          meetingId: meeting.id,
        })

        if (!file) {
          await unlink(partPath).catch(() => {})

          return status(409, { message: TOO_MANY_FILES })
        }

        await rename(partPath, destination)

        return status(201, await toResponse(file, meeting.id, (payload) => fileJwt.sign(payload)))
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
        409: messageResponse,
        413: messageResponse,
        415: messageResponse,
      },
      detail: { summary: 'Upload a file to a meeting', security },
    },
  )
  .get(
    '/:id/files',
    async ({ params, userId, fileJwt, status }) => {
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

export const filesModule = new Elysia().use(ownerRoutes).use(fileContentRoutes)
