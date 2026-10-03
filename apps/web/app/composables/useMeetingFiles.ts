import type { MeetingFile } from '~/types/files'
import { apiHref } from '~/utils/api'

/**
 * Отказ загрузки в той же форме, что у ofetch: код в `statusCode`, тело в
 * `data`. Тогда `statusOf`, `isUnauthorized` и `apiMessageOf` из `utils/api.ts`
 * разбирают его так же, как отказы `$fetch`. `statusCode` нет — ответа не было
 * вовсе: api не запущен или пропала сеть.
 */
export class UploadError extends Error {
  readonly statusCode: number | undefined
  readonly data: unknown

  constructor(statusCode: number | undefined, data?: unknown) {
    super(statusCode === undefined ? 'Upload failed: no response' : `Upload failed: ${statusCode}`)
    this.statusCode = statusCode
    this.data = data
  }
}

/** Пользователь нажал «Отменить»: это не ошибка, сообщать о ней нечего. */
export class UploadAbortedError extends Error {
  constructor() {
    super('Upload aborted')
  }
}

export interface UploadCallbacks {
  /** Доля байт, ушедших в сокет, от 0 до 1. */
  onProgress?: (fraction: number) => void
  /**
   * Тело ушло целиком, но api ещё пишет его на диск: до ответа может пройти
   * заметное время, и без смены подписи 100 % читаются как зависание.
   */
  onSent?: () => void
}

export interface UploadHandle {
  /** Метаданные файла; отказ — `UploadError` или `UploadAbortedError`. */
  done: Promise<MeetingFile>
  /** Рвёт соединение: api видит обрыв и сам удаляет недописанный `.part`. */
  abort: () => void
}

/**
 * Запросы к `/meetings/:id/files`.
 */
export const useMeetingFiles = () => {
  const { authHeaders } = useAuth()
  const { apiUrl } = useRuntimeConfig().public

  /**
   * Файлы встречи по дате загрузки — так их сортирует api. Отказ не глотает:
   * 401 вызывающий обрабатывает как конец сессии, 404 — как «встречи нет».
   */
  const fetchFiles = (meetingId: string): Promise<MeetingFile[]> =>
    $fetch<MeetingFile[]>(`/meetings/${meetingId}/files`, {
      baseURL: apiUrl,
      headers: authHeaders(),
    })

  /**
   * Отправка через `XMLHttpRequest`, а не `$fetch`: ни ofetch, ни `fetch` не
   * сообщают о переданных байтах (у `fetch` с телом-потоком в Chrome нужен
   * HTTP/2), а без них процент показать нечем. `upload.onprogress` даёт
   * прогресс, `abort()` — отмену, которая доходит до api.
   *
   * Тело — сам файл, без `multipart`: api не парсит тело и сливает его на диск
   * потоком, поэтому имя уезжает заголовком. `encodeURIComponent` обязателен с
   * обеих сторон: значение HTTP-заголовка — байты Latin-1, и кириллическое имя
   * `setRequestHeader` не пустит («String contains non ISO-8859-1 code point»).
   * `Content-Length` браузер для `File` ставит сам — по нему api отбивает
   * лишний размер, не читая тела.
   */
  const uploadFile = (
    meetingId: string,
    file: File,
    callbacks: UploadCallbacks = {},
  ): UploadHandle => {
    const xhr = new XMLHttpRequest()

    const done = new Promise<MeetingFile>((resolve, reject) => {
      xhr.open('POST', apiHref(apiUrl, `/meetings/${meetingId}/files`))
      xhr.responseType = 'json'

      for (const [name, value] of Object.entries(authHeaders())) {
        xhr.setRequestHeader(name, value)
      }

      xhr.setRequestHeader('x-file-name', encodeURIComponent(file.name))
      // Браузер оставляет тип пустым для форматов, которых нет в реестре ОС, —
      // на Windows это обычное дело для `.m4a` и `.webm`. Api такое пропускает.
      xhr.setRequestHeader('content-type', file.type || 'application/octet-stream')

      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable && event.total > 0) {
          callbacks.onProgress?.(event.loaded / event.total)
        }
      }

      xhr.upload.onload = () => callbacks.onSent?.()

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(xhr.response as MeetingFile)
        } else {
          reject(new UploadError(xhr.status, xhr.response))
        }
      }

      // Сеть пропала, api не запущен или CORS отбил ответ — кода нет.
      xhr.onerror = () => reject(new UploadError(undefined))
      xhr.onabort = () => reject(new UploadAbortedError())

      xhr.send(file)
    })

    return { done, abort: () => xhr.abort() }
  }

  /** 204 — файла больше нет ни в базе, ни на диске; старая ссылка отвечает 404. */
  const deleteFile = (meetingId: string, fileId: string): Promise<void> =>
    $fetch(`/meetings/${meetingId}/files/${fileId}`, {
      baseURL: apiUrl,
      method: 'DELETE',
      headers: authHeaders(),
    })

  return { fetchFiles, uploadFile, deleteFile }
}
