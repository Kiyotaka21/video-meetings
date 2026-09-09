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
