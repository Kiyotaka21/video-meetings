import { Elysia, t } from 'elysia'

import { prisma } from '../../db/prisma'
import { isUuid } from '../../lib/ids'
import { fileLinkJwt } from './link'
import { storedPath } from './storage'

/**
 * Отдача файла по ссылке из списка: запись играет в `<video src>`, документ
 * скачивается по `<a href>`. Ни тот, ни другой не шлёт `Authorization`, поэтому
 * маршрут живёт в своём инстансе, без guard'а `authenticated`: доступ несёт
 * файловый токен в `?token=` (см. `link.ts`).
 */

const messageResponse = t.Object({ message: t.String() })

const UNAUTHORIZED = { message: 'Unauthorized' } as const

/** Чужая встреча, удалённый файл и файл, пропавший с диска, неотличимы снаружи. */
const FILE_NOT_FOUND = { message: 'File not found' } as const

interface ByteRange {
  start: number
  end: number
}

/** Один диапазон: `bytes=0-99`, `bytes=100-`, `bytes=-100`. */
const SINGLE_RANGE = /^bytes=(\d*)-(\d*)$/

/**
 * Разбор `Range` по RFC 9110 — ровно то, что нужно плееру для перемотки.
 *
 * `null` — отдать файл целиком с 200: заголовка нет, он с браком или просит
 * несколько диапазонов (RFC разрешает такое игнорировать, а 400 сломал бы
 * плеер). `'unsatisfiable'` — диапазон начинается за концом файла, это 416.
 */
const parseRange = (
  header: string | undefined,
  size: number,
): ByteRange | 'unsatisfiable' | null => {
  const match = header === undefined ? null : SINGLE_RANGE.exec(header.trim())

  if (!match) {
    return null
  }

  const [, first = '', last = ''] = match

  if (first === '' && last === '') {
    return null
  }

  // `bytes=-100` — последние 100 байт, а не первые: так плеер дочитывает
  // индекс mp4, который лежит в конце файла.
  if (first === '') {
    const length = Number(last)

    return length === 0 || size === 0
      ? 'unsatisfiable'
      : { start: Math.max(size - length, 0), end: size - 1 }
  }

  const start = Number(first)

  // Конец раньше начала — синтаксический брак, то есть весь файл. Сверяется
  // с присланным концом, а не с размером файла: иначе у пустого файла
  // `bytes=0-` (конец «−1») выглядел браком и получал 200 вместо 416.
  if (last !== '' && Number(last) < start) {
    return null
  }

  if (start >= size) {
    return 'unsatisfiable'
  }

  // Конец за пределами файла — не ошибка: отдаём до последнего байта.
  return { start, end: last === '' ? size - 1 : Math.min(Number(last), size - 1) }
}

/**
 * `encodeURIComponent` по RFC 5987: он не трогает `'()*`, а в `filename*` они
 * недопустимы — апостроф там вообще разделитель кодировки и языка.
 */
const encodeRfc5987 = (value: string): string =>
  encodeURIComponent(value).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  )

/**
 * Имя файла при скачивании. `attachment` можно ставить всегда: к подресурсам
 * (`<video>`, `<audio>`) браузеры его не применяют, так что один заголовок
 * закрывает и плеер, и скачивание.
 *
 * Две формы сразу. `filename*` в UTF-8 читают все современные браузеры — иначе
 * кириллица и пробелы приезжают битыми. `filename=` — запасной для старых
 * клиентов, и в нём только печатный ASCII: сырую кириллицу не пропустит даже
 * конструктор `Headers`.
 */
const contentDisposition = (name: string): string => {
  const ascii = name.replace(/[^\x20-\x7e]|["\\]/g, '_')

  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeRfc5987(name)}`
}

export const fileContentRoutes = new Elysia({
  name: 'files.content',
  prefix: '/meetings',
  tags: ['Files'],
})
  .use(fileLinkJwt)
  .get(
    '/:id/files/:fileId/content',
    async ({ params, query, headers, fileJwt, set, status }) => {
      // `verify` отдаёт false на любую негодность разом: чужая подпись (в том
      // числе сессионный токен), брак, истёкший `exp`. Годный токен соседнего
      // файла — тоже 401: ссылка открывает ровно свой файл.
      const payload = query.token ? await fileJwt.verify(query.token) : false

      if (payload === false || payload.sub !== params.fileId) {
        return status(401, UNAUTHORIZED)
      }

      // Строка ищется по паре (файл, встреча): годный токен с id чужой встречи
      // в пути не находит ничего, а не чужой файл. `fileId` равен `sub`
      // нашего токена, то есть uuid; id встречи из пути сверяется с форматом
      // до базы — `%00` ронял запрос пятисоткой.
      const file = isUuid(params.id)
        ? await prisma.meetingFile.findFirst({
            where: { id: params.fileId, meetingId: params.id },
            select: { name: true, mimeType: true, path: true },
          })
        : null

      if (!file) {
        return status(404, FILE_NOT_FOUND)
      }

      const blob = Bun.file(storedPath(file.path))

      // Строка есть, а файла нет — рассинхрон, но отвечать на него надо 404:
      // `Bun.file` на несуществующий путь даёт размер 0 и пустое тело без
      // ошибки (ресерч, замер 10), то есть «успешный» ответ без байтов. Один
      // stat на запрос — цена, а не «на каждый чанк»: чанки идут внутри ответа.
      if (!(await blob.exists())) {
        return status(404, FILE_NOT_FOUND)
      }

      const size = blob.size
      const range = parseRange(headers.range, size)

      // `Accept-Ranges` во всех ответах: по нему плеер решает, показывать ли
      // перемотку вообще.
      set.headers['accept-ranges'] = 'bytes'

      if (range === 'unsatisfiable') {
        set.headers['content-range'] = `bytes */${size}`

        return status(416, { message: 'Range Not Satisfiable' })
      }

      set.headers['content-type'] = file.mimeType
      set.headers['content-disposition'] = contentDisposition(file.name)
      // `mimeType` в метаданных — канонический тип формата, а не заявленный
      // клиентом (`limits.ts`); `nosniff` не даёт браузеру передумать.
      set.headers['x-content-type-options'] = 'nosniff'

      // Сам `Bun.file`, а не `Response` с ним. `Response` Elysia
      // переупаковывает в поток (в `set.headers` всегда CORS), и живой сервер
      // отдавал и 200, и 206 chunked — без длины, в обход sendfile, каждый байт
      // записи через JS (замер 21 в ресерче). `Bun.file` Elysia отдаёт своим
      // `handleFile`: длину Bun ставит сам, а `Range` она режет по тому же
      // заголовку запроса. Для одного годного диапазона её разбор совпадает с
      // `parseRange` байт в байт — начало, конец, суффикс, обрезка по размеру;
      // это и сверяют тесты на `Range`, а длину — `tests/live.e2e.test.ts`.
      if (range !== null || headers.range === undefined) {
        return blob
      }

      // Брак и несколько диапазонов Elysia разобрала бы по-своему: несколько —
      // 206 на первый, `bytes=-` и конец раньше начала — 416. Наш контракт —
      // файл целиком с 200 (RFC 9110 разрешает игнорировать непонятный
      // `Range`), поэтому здесь ответ собирается руками. Он уходит chunked, но
      // плеер таких заголовков не шлёт.
      return new Response(blob, { headers: { 'content-length': String(size) } })
    },
    {
      params: t.Object({ id: t.String(), fileId: t.String() }),
      // Необязательный: без токена — наш 401, а не 422 валидации схемы.
      query: t.Object({ token: t.Optional(t.String()) }),
      response: {
        401: messageResponse,
        404: messageResponse,
        416: messageResponse,
      },
      detail: {
        summary: 'Stream or download a file by its link',
        description:
          'Ссылку с файловым токеном отдаёт `GET /meetings/:id/files` в поле `url`. ' +
          'Поддерживает `Range` для перемотки.',
      },
    },
  )
