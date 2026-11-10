import { describe, expect, it } from 'bun:test'

import { createRateLimiter, tooManyAttempts } from '../src/lib/rate-limit'
import { LOGIN_FAILURE_LIMIT, PASSWORD_FAILURE_LIMIT } from '../src/modules/auth'
import { getJson, postJson, requestRaw, jsonInit } from './helpers/http'
import { registerUser, TEST_PASSWORD } from './helpers/users'

/**
 * Перебор пароля. Вход и смена пароля считают неудачи по адресу и по
 * пользователю: каждая — argon2 на 64 МиБ, и без потолка `/auth/login`
 * перебирали бы без помех, а украденный токен позволял бы подобрать текущий
 * пароль на `/auth/me/password` и сменить его — то есть увести учётку.
 *
 * Потолки по IP (вход и регистрация) через `app.handle` не проверить — адреса
 * клиента там нет; их проверяет `tests/live.e2e.test.ts`.
 */

const LOGIN = '/auth/login'
const PASSWORD = '/auth/me/password'
const WRONG = 'definitely-not-the-password'

const messageOf = (body: unknown): string => String((body as { message?: unknown }).message)

describe('Вход: неудачи по адресу', () => {
  it(`после ${LOGIN_FAILURE_LIMIT} неудач — 429 даже с верным паролем, с Retry-After`, async () => {
    const user = await registerUser()

    for (let attempt = 0; attempt < LOGIN_FAILURE_LIMIT; attempt++) {
      const response = await postJson(LOGIN, { email: user.email, password: WRONG })

      expect(response.status).toBe(401)
    }

    const blocked = await requestRaw(
      LOGIN,
      jsonInit('POST', { email: user.email, password: TEST_PASSWORD }),
    )
    const body: unknown = await blocked.json()

    expect(blocked.status).toBe(429)
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0)
    // Текст — для показа как есть, как у 403 смены пароля и 409 загрузки.
    expect(messageOf(body)).toContain('Попробуйте через')
  })

  it('адрес в другом регистре — тот же счётчик', async () => {
    const user = await registerUser()

    for (let attempt = 0; attempt < LOGIN_FAILURE_LIMIT; attempt++) {
      await postJson(LOGIN, { email: user.email.toUpperCase(), password: WRONG })
    }

    expect((await postJson(LOGIN, { email: user.email, password: TEST_PASSWORD })).status).toBe(429)
  })

  it('чужой адрес счётчик не задевает', async () => {
    const victim = await registerUser()
    const neighbour = await registerUser()

    for (let attempt = 0; attempt < LOGIN_FAILURE_LIMIT; attempt++) {
      await postJson(LOGIN, { email: victim.email, password: WRONG })
    }

    expect(
      (await postJson(LOGIN, { email: neighbour.email, password: TEST_PASSWORD })).status,
    ).toBe(200)
  })

  it('удачный вход обнуляет счётчик: опечатки владельца не копятся', async () => {
    const user = await registerUser()

    for (let attempt = 0; attempt < LOGIN_FAILURE_LIMIT - 1; attempt++) {
      await postJson(LOGIN, { email: user.email, password: WRONG })
    }

    expect((await postJson(LOGIN, { email: user.email, password: TEST_PASSWORD })).status).toBe(200)

    for (let attempt = 0; attempt < LOGIN_FAILURE_LIMIT - 1; attempt++) {
      expect((await postJson(LOGIN, { email: user.email, password: WRONG })).status).toBe(401)
    }
  })

  it('неизвестный адрес считается так же: ответ не выдаёт, есть ли учётка', async () => {
    const email = `ghost-${crypto.randomUUID()}@example.com`

    for (let attempt = 0; attempt < LOGIN_FAILURE_LIMIT; attempt++) {
      expect((await postJson(LOGIN, { email, password: WRONG })).status).toBe(401)
    }

    expect((await postJson(LOGIN, { email, password: WRONG })).status).toBe(429)
  })
})

describe('Смена пароля: неудачи по пользователю', () => {
  it(`после ${PASSWORD_FAILURE_LIMIT} неверных текущих — 429, сессия и пароль прежние`, async () => {
    const user = await registerUser()
    const change = (currentPassword: string) =>
      postJson(PASSWORD, { currentPassword, newPassword: 'brand-new-password' }, user.token)

    for (let attempt = 0; attempt < PASSWORD_FAILURE_LIMIT; attempt++) {
      expect((await change(WRONG)).status).toBe(403)
    }

    const blocked = await change(TEST_PASSWORD)

    // 429, а не 401: на фронтенде 401 — конец сессии, а сессия жива.
    expect(blocked.status).toBe(429)
    expect(messageOf(blocked.body)).toContain('Попробуйте через')
    expect((await getJson('/auth/me', user.token)).status).toBe(200)
    expect((await postJson(LOGIN, { email: user.email, password: TEST_PASSWORD })).status).toBe(200)
  })

  it('удачная смена обнуляет счётчик', async () => {
    const user = await registerUser()

    for (let attempt = 0; attempt < PASSWORD_FAILURE_LIMIT - 1; attempt++) {
      await postJson(
        PASSWORD,
        { currentPassword: WRONG, newPassword: 'brand-new-password' },
        user.token,
      )
    }

    const changed = await postJson(
      PASSWORD,
      { currentPassword: TEST_PASSWORD, newPassword: 'brand-new-password' },
      user.token,
    )
    const token = String((changed.body as { token: unknown }).token)

    expect(changed.status).toBe(200)

    for (let attempt = 0; attempt < PASSWORD_FAILURE_LIMIT - 1; attempt++) {
      expect(
        (
          await postJson(
            PASSWORD,
            { currentPassword: WRONG, newPassword: 'another-password' },
            token,
          )
        ).status,
      ).toBe(403)
    }
  })
})

describe('createRateLimiter', () => {
  const clock = () => {
    let time = 1_000_000

    return { now: () => time, advance: (ms: number) => (time += ms) }
  }

  it('считает попытки в окне и отпускает после него', () => {
    const { now, advance } = clock()
    const limiter = createRateLimiter({ limit: 2, windowMs: 60_000, now })

    limiter.hit('a')
    expect(limiter.retryAfter('a')).toBe(0)

    limiter.hit('a')
    expect(limiter.retryAfter('a')).toBe(60)

    advance(59_001)
    expect(limiter.retryAfter('a')).toBe(1)

    advance(999)
    expect(limiter.retryAfter('a')).toBe(0)
  })

  it('reset забывает ключ, другие ключи независимы', () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000 })

    limiter.hit('a')
    limiter.hit('b')
    limiter.reset('a')

    expect(limiter.retryAfter('a')).toBe(0)
    expect(limiter.retryAfter('b')).toBeGreaterThan(0)
  })

  it('поток уникальных ключей упирается в maxKeys', () => {
    const { now } = clock()
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000, maxKeys: 3, now })

    for (const key of ['a', 'b', 'c', 'd']) {
      limiter.hit(key)
    }

    // Вытеснен самый старый ключ, свежие на месте.
    expect(limiter.retryAfter('a')).toBe(0)
    expect(limiter.retryAfter('d')).toBeGreaterThan(0)
  })

  it('текст отказа — в минутах, не меньше одной', () => {
    expect(tooManyAttempts('Слишком много попыток.', 1)).toBe(
      'Слишком много попыток. Попробуйте через 1 мин.',
    )
    expect(tooManyAttempts('Слишком много попыток.', 900)).toBe(
      'Слишком много попыток. Попробуйте через 15 мин.',
    )
  })
})
