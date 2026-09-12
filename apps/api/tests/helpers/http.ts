import { app } from '../../src/app'

export interface ApiResponse {
  status: number
  /** Сырое тело — нужно, чтобы проверять, чего в ответе быть не должно. */
  raw: string
  body: unknown
}

/**
 * Гоняет запрос через `app.handle`, без открытия порта, но по всему конвейеру
 * Elysia: CORS, валидация схем, обработчики ошибок, сериализация ответа.
 *
 * Хост обязан быть с точкой: на `http://x/...` Bun отвечает 404 на любой
 * маршрут, и тест падает не по делу.
 */
export const request = async (path: string, init?: RequestInit): Promise<ApiResponse> => {
  const response = await app.handle(new Request(`http://localhost${path}`, init))
  const raw = await response.text()

  let body: unknown
  try {
    body = raw.length > 0 ? JSON.parse(raw) : undefined
  } catch {
    body = undefined
  }

  return { status: response.status, raw, body }
}

/** Без токена заголовка нет вовсе — так проверяется и «Authorization не прислали». */
const authorization = (token?: string): Record<string, string> =>
  token === undefined ? {} : { authorization: `Bearer ${token}` }

export const postJson = (path: string, payload: unknown, token?: string): Promise<ApiResponse> =>
  request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authorization(token) },
    body: JSON.stringify(payload),
  })

export const getJson = (path: string, token?: string): Promise<ApiResponse> =>
  request(path, { method: 'GET', headers: authorization(token) })

export interface UploadedFile {
  /** Имя, каким его «выбрал пользователь»: в заголовок уходит percent-encoded. */
  name: string
  /** Заявленный тип. `undefined` — клиент не прислал `Content-Type` вовсе. */
  type?: string
  /** Сырые байты файла: строка, Uint8Array или поток — как их принимает `Request`. */
  body: RequestInit['body']
}

/**
 * Загрузка файла так же, как её шлёт браузер: тело — сырые байты, имя и тип —
 * заголовками. Значение заголовка это байты Latin-1, поэтому кириллическое имя
 * не собрать напрямую — `new Request` бросит исключение ещё до `app.handle`.
 */
export const postFile = (path: string, file: UploadedFile, token?: string): Promise<ApiResponse> =>
  request(path, {
    method: 'POST',
    headers: {
      'x-file-name': encodeURIComponent(file.name),
      ...(file.type === undefined ? {} : { 'content-type': file.type }),
      ...authorization(token),
    },
    body: file.body,
  })
