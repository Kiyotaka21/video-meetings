import { Elysia, t } from 'elysia'

import { prisma } from '../../db/prisma'
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
  const end = last === '' ? size - 1 : Number(last)

  if (end < start) {
    return null
  }

  if (start >= size) {
    return 'unsatisfiable'
  }

  // Конец за пределами файла — не ошибка: отдаём до последнего байта.
  return { start, end: Math.min(end, size - 1) }
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
      // в пути не находит ничего, а не чужой файл.
      const file = await prisma.meetingFile.findFirst({
        where: { id: params.fileId, meetingId: params.id },
        select: { name: true, mimeType: true, path: true },
      })

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

      const fileHeaders = {
        'content-type': file.mimeType,
        'content-disposition': contentDisposition(file.name),
        // `mimeType` в метаданных — канонический тип формата, а не заявленный
        // клиентом (`limits.ts`); `nosniff` не даёт браузеру передумать.
        'x-content-type-options': 'nosniff',
      }

      // `Response` с `Bun.file` и `Content-Length` руками, а не авто-`Range`
      // Bun: Elysia переупаковывает ответ, связь с файлом теряется, и на
      // `Range` молча приходит 200 с файлом целиком (ресерч, 2.2, elysia#1868).
      // Без явной длины ответ уходит chunked, и `<video>` не знает длительности.
      if (range === null) {
        return new Response(blob, {
          headers: { ...fileHeaders, 'content-length': String(size) },
        })
      }

      // `.stream()` у куска обязателен. Elysia переупаковывает ответ через
      // `new Response(response.body)`, как только в `set.headers` что-то есть, —
      // а здесь там `Accept-Ranges` и CORS. У `Response` из `BunFile.slice()`
      // поток `body` теряет конец куска и читает до конца файла: на
      // `bytes=0-99` уходило 206 с тысячей байт (замер 19 в ресерче).
      return new Response(blob.slice(range.start, range.end + 1).stream(), {
        status: 206,
        headers: {
          ...fileHeaders,
          'content-length': String(range.end - range.start + 1),
          'content-range': `bytes ${range.start}-${range.end}/${size}`,
        },
      })
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
