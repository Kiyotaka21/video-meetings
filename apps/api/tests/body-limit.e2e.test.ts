import { randomUUID } from 'node:crypto'

import { describe, expect, it } from 'bun:test'
import { Elysia } from 'elysia'

import { app } from '../src/app'
import { MAX_JSON_BODY_SIZE, STREAMING_ROUTES } from '../src/plugins/body-limit'
import { INTERNAL_ERROR, internalErrors } from '../src/plugins/errors'
import { createMeeting, filesPath } from './helpers/files'
import { request, requestRaw } from './helpers/http'
import { registerUser } from './helpers/users'
import { TEST_FRONTEND_ORIGIN } from './setup'

/**
 * Тело со схемой Elysia читает в память целиком, до валидации и до guard'а,
 * а потолок у Bun.serve поднят до 64 ГиБ ради записей. Рубеж — 64 КиБ на всех
 * маршрутах, кроме потоковых загрузок, и отказ без чтения тела.
 */

const LOGIN = '/auth/login'

/** Тело-поток без `Content-Length` — так выглядит chunked-запрос. */
const chunked = (text: string): ReadableStream<Uint8Array> =>
  new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text))
      controller.close()
    },
  })

describe('Потолок тела JSON-маршрутов', () => {
  it('Content-Length больше 64 КиБ — 413 до чтения тела, открытый маршрут тоже', async () => {
    // Заявлено больше, чем прислано: отказ по заголовку не ждёт тела вовсе.
    const response = await requestRaw(LOGIN, {
      method: 'POST',
      headers: {
        origin: TEST_FRONTEND_ORIGIN,
        'content-type': 'application/json',
        'content-length': String(MAX_JSON_BODY_SIZE + 1),
      },
      body: '{}',
    })

    expect(response.status).toBe(413)
    // Отказ обязан быть читаем фронтендом, как и все остальные.
    expect(response.headers.get('access-control-allow-origin')).toBe(TEST_FRONTEND_ORIGIN)
  })

  it('ровно 64 КиБ проходит рубеж и доходит до валидатора', async () => {
    const prefix = '{"email":"user@example.com","password":"'
    const body = `${prefix}${'x'.repeat(MAX_JSON_BODY_SIZE - prefix.length - 2)}"}`

    const response = await request(LOGIN, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': String(body.length) },
      body,
    })

    expect(body.length).toBe(MAX_JSON_BODY_SIZE)
    // Пароль длиннее 128 — отказ валидатора, а не потолка тела.
    expect(response.status).toBe(422)
  })

  it('тело без Content-Length (chunked) — 411, закрытый маршрут тоже', async () => {
    const user = await registerUser()

    for (const [method, path] of [
      ['POST', LOGIN],
      ['PATCH', '/auth/me'],
      ['POST', '/meetings'],
    ] as const) {
      const response = await requestRaw(path, {
        method,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${user.token}` },
        body: chunked('{}'),
      })

      expect(response.status).toBe(411)
    }
  })

  it('потоковая загрузка файла рубежом не задета: документ больше 64 КиБ принимается', async () => {
    const user = await registerUser()
    const meetingId = await createMeeting(user.token)
    const bytes = new Uint8Array(MAX_JSON_BODY_SIZE * 2)

    const response = await request(filesPath(meetingId), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${user.token}`,
        'x-file-name': 'notes.txt',
        'content-length': String(bytes.byteLength),
      },
      body: bytes,
    })

    expect(response.status).toBe(201)
  })

  it('GET и DELETE без тела рубеж не трогает', async () => {
    expect((await request('/health')).status).toBe(200)
    expect(
      (await request(`/meetings/${randomUUID()}/files/${randomUUID()}`, { method: 'DELETE' }))
        .status,
    ).toBe(401)
  })
})

describe('Список потоковых маршрутов совпадает с приложением', () => {
  /** Путь маршрута с подставленными параметрами: `/meetings/:id/files` → `/meetings/<uuid>/files`. */
  const samplePath = (path: string): string => path.replace(/:[^/]+/g, randomUUID())

  const parsesNothing = (hooks: unknown): boolean => {
    const parse = (hooks as { parse?: unknown }).parse
    const parsers = Array.isArray(parse) ? parse : parse === undefined ? [] : [parse]

    return parsers.some(
      (parser) => parser === 'none' || (parser as { fn?: unknown } | null)?.fn === 'none',
    )
  }

  const matchesStreaming = (method: string, path: string): boolean =>
    STREAMING_ROUTES.some((route) => route.method === method && route.path.test(path))

  it('каждый маршрут с parse: none — в списке, и ничего лишнего', () => {
    const routes = app.routes.filter((route) => !['GET', 'HEAD', 'OPTIONS'].includes(route.method))

    // Без этой сверки новый потоковый маршрут упёрся бы в 64 КиБ, а
    // забытый в списке JSON-маршрут остался бы без потолка.
    for (const route of routes) {
      expect([
        route.method,
        route.path,
        matchesStreaming(route.method, samplePath(route.path)),
      ]).toEqual([route.method, route.path, parsesNothing(route.hooks)])
    }

    expect(routes.filter((route) => parsesNothing(route.hooks))).toHaveLength(
      STREAMING_ROUTES.length,
    )
  })
})

describe('Необработанное исключение', () => {
  it('уходит общим 500 без текста ошибки', async () => {
    // Свой маленький инстанс: в приложении маршрута, который бросает, нет — и
    // не должно быть. Плагин тот же, что подключён в `src/app.ts`.
    const probe = new Elysia().use(internalErrors).get('/boom', () => {
      throw new Error('secret detail at /src/modules/secret.ts')
    })

    const originalError = console.error
    console.error = () => {}

    try {
      const response = await probe.handle(new Request('http://localhost/boom'))
      const raw = await response.text()

      expect(response.status).toBe(500)
      expect(JSON.parse(raw)).toEqual(INTERNAL_ERROR)
      expect(raw).not.toContain('secret')
    } finally {
      console.error = originalError
    }
  })

  it('ошибка со своим полем code (как у Prisma) маскируется тоже', async () => {
    // Elysia передаёт в `onError` поле `code` самой ошибки: у Prisma это
    // `P2010` и прочие, и проверка «code === UNKNOWN» такие пропускала.
    const probe = new Elysia().use(internalErrors).get('/boom', () => {
      throw Object.assign(new Error('Invalid `prisma.meeting.findFirst()` at secret.ts'), {
        code: 'P2010',
      })
    })

    const originalError = console.error
    console.error = () => {}

    try {
      const response = await probe.handle(new Request('http://localhost/boom'))
      const raw = await response.text()

      expect(response.status).toBe(500)
      expect(JSON.parse(raw)).toEqual(INTERNAL_ERROR)
    } finally {
      console.error = originalError
    }
  })

  it('отказы api и валидатора свои тела сохраняют', async () => {
    const response = await request(LOGIN, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': '2' },
      body: '{}',
    })

    expect(response.status).toBe(422)
    expect(response.body).not.toEqual(INTERNAL_ERROR)
  })
})
