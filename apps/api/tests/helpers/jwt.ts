import { Buffer } from 'node:buffer'
import { createHmac } from 'node:crypto'

export interface JwtPayload {
  sub?: unknown
  email?: unknown
  exp?: unknown
  [claim: string]: unknown
}

export interface DecodedJwt {
  header: Record<string, unknown>
  payload: JwtPayload
  isSignedWith: (secret: string) => boolean
}

const encodeSegment = (value: object): string =>
  Buffer.from(JSON.stringify(value)).toString('base64url')

/**
 * Выпускает HS256-токен теми же руками, что и разбирает, — чтобы собрать
 * заведомо негодные: подписанные чужим секретом или с истёкшим `exp`. Настоящие
 * токены выдаёт приложение, этот хелпер их не подменяет.
 */
export const signJwt = (payload: Record<string, unknown>, secret: string): string => {
  const header = encodeSegment({ alg: 'HS256', typ: 'JWT' })
  const body = encodeSegment(payload)
  const signature = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url')

  return `${header}.${body}.${signature}`
}

const decodeSegment = (segment: string): Record<string, unknown> => {
  const json = Buffer.from(segment, 'base64url').toString('utf8')
  const value: unknown = JSON.parse(json)

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Сегмент JWT не является JSON-объектом: ${json}`)
  }

  return value as Record<string, unknown>
}

/**
 * Разбирает и проверяет JWT без внешних зависимостей: тест не должен знать,
 * какой библиотекой выпущен токен, — только формат (RFC 7519) и подпись HS256.
 */
export const decodeJwt = (token: string): DecodedJwt => {
  const segments = token.split('.')
  const [header, payload, signature] = segments

  if (segments.length !== 3 || !header || !payload || !signature) {
    throw new Error(`Ожидался JWT из трёх сегментов, получено: ${JSON.stringify(token)}`)
  }

  return {
    header: decodeSegment(header),
    payload: decodeSegment(payload),
    isSignedWith: (secret: string) =>
      createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url') === signature,
  }
}
