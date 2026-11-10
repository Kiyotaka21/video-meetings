import { randomUUID } from 'node:crypto'

import { describe, expect, it } from 'bun:test'

import { createMeeting, filesPath } from './helpers/files'
import { jsonInit, request, requestRaw } from './helpers/http'
import { registerUser } from './helpers/users'
import { TEST_FRONTEND_ORIGIN } from './setup'

/**
 * CORS — условие того, что фронтенд вообще прочтёт ответ api. Русские тексты
 * 409/413/415 и ветка «401 → выйти» на фронтенде работают, только если браузер
 * отдаёт странице тело отказа: ответ без `Access-Control-Allow-Origin` он
 * прячет целиком, и пользователь видит «Нет связи» вместо причины.
 *
 * Поэтому проверяются именно отказы, а не только 200: заголовки обязаны быть
 * и у ответов, которые guard или валидатор отдают до обработчика.
 */

const FOREIGN_ORIGIN = 'http://evil.example'

/** Preflight кэшируется браузером на столько секунд; Chrome режет до 7200. */
const PREFLIGHT_MAX_AGE_SECONDS = '7200'

const withOrigin = (init: RequestInit = {}, origin = TEST_FRONTEND_ORIGIN): RequestInit => ({
  ...init,
  headers: { ...(init.headers as Record<string, string> | undefined), origin },
})

const allowOriginOf = async (
  path: string,
  init?: RequestInit,
): Promise<[number, string | null]> => {
  const response = await requestRaw(path, withOrigin(init))

  return [response.status, response.headers.get('access-control-allow-origin')]
}

const preflight = (
  path: string,
  method: string,
  requestHeaders: string,
  origin = TEST_FRONTEND_ORIGIN,
) =>
  requestRaw(path, {
    method: 'OPTIONS',
    headers: {
      origin,
      'access-control-request-method': method,
      'access-control-request-headers': requestHeaders,
    },
  })

describe('CORS на отказах', () => {
  it('401 от guard несёт Access-Control-Allow-Origin', async () => {
    const [status, allowOrigin] = await allowOriginOf('/auth/me')

    expect(status).toBe(401)
    expect(allowOrigin).toBe(TEST_FRONTEND_ORIGIN)
  })

  it('422 от валидатора несёт Access-Control-Allow-Origin', async () => {
    const [status, allowOrigin] = await allowOriginOf(
      '/auth/login',
      jsonInit('POST', { email: 'not-an-email', password: 'short' }),
    )

    expect(status).toBe(422)
    expect(allowOrigin).toBe(TEST_FRONTEND_ORIGIN)
  })

  it('404, 415 и 413 загрузки несут Access-Control-Allow-Origin', async () => {
    const user = await registerUser()
    const meetingId = await createMeeting(user.token)
    const authorization = `Bearer ${user.token}`

    const missing = await allowOriginOf(filesPath(randomUUID()), {
      method: 'POST',
      headers: { authorization, 'x-file-name': 'a.pdf' },
      body: 'x',
    })
    const unsupported = await allowOriginOf(filesPath(meetingId), {
      method: 'POST',
      headers: { authorization, 'x-file-name': 'a.zip' },
      body: 'x',
    })
    const tooLarge = await allowOriginOf(filesPath(meetingId), {
      method: 'POST',
      headers: { authorization, 'x-file-name': 'a.pdf', 'content-length': String(51 * 1024 ** 2) },
      body: 'x',
    })

    expect(missing).toEqual([404, TEST_FRONTEND_ORIGIN])
    expect(unsupported).toEqual([415, TEST_FRONTEND_ORIGIN])
    expect(tooLarge).toEqual([413, TEST_FRONTEND_ORIGIN])
  })

  it('чужой origin разрешения не получает', async () => {
    const response = await requestRaw('/health', withOrigin({}, FOREIGN_ORIGIN))

    expect(response.headers.get('access-control-allow-origin')).not.toBe(FOREIGN_ORIGIN)
    expect(response.headers.get('access-control-allow-origin')).not.toBe('*')
  })
})

describe('Preflight', () => {
  it('загрузка файла: разрешены authorization, content-type и x-file-name', async () => {
    const response = await preflight(
      `/meetings/${randomUUID()}/files`,
      'POST',
      'authorization, content-type, x-file-name',
    )

    const allowedHeaders = (
      response.headers.get('access-control-allow-headers') ?? ''
    ).toLowerCase()

    expect(response.status).toBeLessThan(300)
    expect(response.headers.get('access-control-allow-origin')).toBe(TEST_FRONTEND_ORIGIN)
    for (const header of ['authorization', 'content-type', 'x-file-name']) {
      expect(allowedHeaders).toContain(header)
    }
  })

  it('PUT аватара проходит preflight', async () => {
    const response = await preflight('/auth/me/avatar', 'PUT', 'authorization, content-type')

    expect(response.status).toBeLessThan(300)
    expect((response.headers.get('access-control-allow-methods') ?? '').toUpperCase()).toContain(
      'PUT',
    )
  })

  it('ответ на preflight кэшируется браузером на два часа, а не на секунды', async () => {
    // Каждый закрытый запрос несёт `Authorization`, то есть перед ним идёт
    // OPTIONS, если кэш preflight'а по этому адресу истёк. Дефолт плагина — 5 с:
    // в проде это лишний круг до сервера почти перед каждым запросом.
    const response = await preflight('/meetings', 'GET', 'authorization')

    expect(response.headers.get('access-control-max-age')).toBe(PREFLIGHT_MAX_AGE_SECONDS)
  })

  it('чужому origin preflight разрешения не даёт', async () => {
    const response = await preflight('/meetings', 'GET', 'authorization', FOREIGN_ORIGIN)

    expect(response.headers.get('access-control-allow-origin')).not.toBe(FOREIGN_ORIGIN)
  })
})

describe('GET /health', () => {
  it('открыт и отвечает ровно status, uptime и timestamp', async () => {
    const response = await request('/health')
    const body = response.body as Record<string, unknown>

    expect(response.status).toBe(200)
    expect(Object.keys(body).sort()).toEqual(['status', 'timestamp', 'uptime'])
    expect(body.status).toBe('ok')
    expect(typeof body.uptime).toBe('number')
    expect(Number(body.uptime)).toBeGreaterThanOrEqual(0)
    expect(body.timestamp).toBe(new Date(String(body.timestamp)).toISOString())
  })

  it('в спеке путь /health, без хвостового слэша', async () => {
    // Ловушка из apps/api/CLAUDE.md: `.get('/')` при `prefix` даёт в спеке `/health/`.
    const paths = Object.keys(((await request('/docs/json')).body as { paths: object }).paths)

    expect(paths).toContain('/health')
    expect(paths).not.toContain('/health/')
  })
})
