import { randomUUID } from 'node:crypto'

import { describe, expect, it } from 'bun:test'

import { getJson, postJson } from './helpers/http'
import { decodeJwt, signJwt } from './helpers/jwt'
import { registerUser, uniqueEmail } from './helpers/users'
import { TEST_JWT_SECRET } from './setup'

/**
 * Контракт аутентификации, e2e через `app.handle`.
 *
 * Требует поднятой базы (`bun run db:up`): регистрация пишет пользователя,
 * логин его ищет — именно это различие тесты и фиксируют.
 */

const REGISTER = '/auth/register'
const LOGIN = '/auth/login'
const ME = '/auth/me'

const PASSWORD = 'correct-horse-battery'

/** Токен живёт ограниченное время; конкретный TTL контрактом не фиксируем. */
const MAX_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60

/**
 * Асимметричных матчеров (`expect.any`) здесь нет намеренно: `toMatchObject` в
 * bun подменяет ими совпавшие поля прямо в проверяемом объекте, и дальше из
 * `body.token` вместо строки достаётся сам матчер.
 */
const tokenOf = (body: unknown): string => {
  const token = (body as { token?: unknown }).token

  expect(typeof token).toBe('string')
  expect(token).not.toBe('')

  return String(token)
}

/** Возвращает `sub` — идентификатор пользователя, зашитый в токен. */
const subjectOf = (token: string): string => {
  const { payload } = decodeJwt(token)

  expect(typeof payload.sub).toBe('string')
  expect(payload.sub).not.toBe('')

  return String(payload.sub)
}

const expectValidAuthToken = (token: string, email: string): void => {
  const { header, payload, isSignedWith } = decodeJwt(token)

  expect(header.alg).toBe('HS256')
  expect(isSignedWith(TEST_JWT_SECRET)).toBe(true)
  expect(isSignedWith('secret-from-another-service')).toBe(false)

  expect(payload.email).toBe(email)
  subjectOf(token)

  const nowSeconds = Math.floor(Date.now() / 1000)
  expect(typeof payload.exp).toBe('number')
  expect(Number(payload.exp)).toBeGreaterThan(nowSeconds)
  expect(Number(payload.exp)).toBeLessThanOrEqual(nowSeconds + MAX_TOKEN_TTL_SECONDS)
}

/** Тела, которые обязан отбить валидатор, не доходя до базы. */
const invalidCredentials: Array<[string, unknown]> = [
  ['пустой объект', {}],
  ['без e-mail', { password: PASSWORD }],
  ['без пароля', { email: 'user@example.com' }],
  ['e-mail без @', { email: 'not-an-email', password: PASSWORD }],
  ['пустой e-mail', { email: '', password: PASSWORD }],
  ['пароль короче 8 символов', { email: 'user@example.com', password: '1234567' }],
  ['пароль не строка', { email: 'user@example.com', password: 12345678 }],
  ['e-mail не строка', { email: 42, password: PASSWORD }],
]

describe('POST /auth/register', () => {
  it('создаёт пользователя и возвращает JWT', async () => {
    const email = uniqueEmail()

    const response = await postJson(REGISTER, { email, password: PASSWORD })

    expect(response.status).toBe(201)
    expectValidAuthToken(tokenOf(response.body), email)
  })

  it('созданный пользователь может войти теми же учётными данными', async () => {
    const email = uniqueEmail()

    const registered = await postJson(REGISTER, { email, password: PASSWORD })
    const login = await postJson(LOGIN, { email, password: PASSWORD })

    expect(registered.status).toBe(201)
    expect(login.status).toBe(200)
  })

  it('не отдаёт пароль или его хеш в ответе', async () => {
    const response = await postJson(REGISTER, { email: uniqueEmail(), password: PASSWORD })

    expect(response.status).toBe(201)
    expect(response.raw).not.toContain(PASSWORD)
    expect(response.body).not.toHaveProperty('password')
    expect(response.body).not.toHaveProperty('passwordHash')
  })

  it('выдаёт разным пользователям разные sub', async () => {
    const first = await postJson(REGISTER, { email: uniqueEmail(), password: PASSWORD })
    const second = await postJson(REGISTER, { email: uniqueEmail(), password: PASSWORD })

    expect(subjectOf(tokenOf(first.body))).not.toBe(subjectOf(tokenOf(second.body)))
  })

  it('второй раз тот же e-mail не регистрирует — 409 и без токена', async () => {
    const email = uniqueEmail()
    await postJson(REGISTER, { email, password: PASSWORD })

    const response = await postJson(REGISTER, { email, password: 'another-password' })

    expect(response.status).toBe(409)
    expect(response.body).not.toHaveProperty('token')
  })

  it('приводит e-mail к нижнему регистру: тот же адрес в другом регистре занят', async () => {
    const email = uniqueEmail()

    const created = await postJson(REGISTER, { email: email.toUpperCase(), password: PASSWORD })
    expect(created.status).toBe(201)
    // В токен уходит нормализованный адрес, а не то, что прислал клиент.
    expectValidAuthToken(tokenOf(created.body), email)

    const duplicate = await postJson(REGISTER, { email, password: PASSWORD })
    expect(duplicate.status).toBe(409)
  })

  it('принимает пароль ровно из 8 символов', async () => {
    const response = await postJson(REGISTER, { email: uniqueEmail(), password: '12345678' })

    expect(response.status).toBe(201)
  })

  for (const [name, payload] of invalidCredentials) {
    it(`отклоняет тело запроса: ${name}`, async () => {
      const response = await postJson(REGISTER, payload)

      expect(response.status).toBe(422)
      expect(response.body).not.toHaveProperty('token')
    })
  }
})

describe('POST /auth/login', () => {
  it('возвращает JWT по верным учётным данным', async () => {
    const email = uniqueEmail()
    await postJson(REGISTER, { email, password: PASSWORD })

    const response = await postJson(LOGIN, { email, password: PASSWORD })

    expect(response.status).toBe(200)
    expectValidAuthToken(tokenOf(response.body), email)
  })

  it('находит существующего пользователя, а не создаёт нового: sub совпадает с регистрацией', async () => {
    const email = uniqueEmail()
    const registered = await postJson(REGISTER, { email, password: PASSWORD })

    const first = await postJson(LOGIN, { email, password: PASSWORD })
    const second = await postJson(LOGIN, { email, password: PASSWORD })

    const subject = subjectOf(tokenOf(registered.body))
    expect(subjectOf(tokenOf(first.body))).toBe(subject)
    expect(subjectOf(tokenOf(second.body))).toBe(subject)
  })

  it('не заводит пользователя для неизвестного e-mail', async () => {
    const email = uniqueEmail()

    const login = await postJson(LOGIN, { email, password: PASSWORD })
    expect(login.status).toBe(401)
    expect(login.body).not.toHaveProperty('token')

    // Если бы логин создал пользователя, регистрация ответила бы 409.
    const registered = await postJson(REGISTER, { email, password: PASSWORD })
    expect(registered.status).toBe(201)
  })

  it('отвечает 401 на неверный пароль', async () => {
    const email = uniqueEmail()
    await postJson(REGISTER, { email, password: PASSWORD })

    const response = await postJson(LOGIN, { email, password: `${PASSWORD}-wrong` })

    expect(response.status).toBe(401)
    expect(response.body).not.toHaveProperty('token')
  })

  it('не различает неизвестный e-mail и неверный пароль', async () => {
    const email = uniqueEmail()
    await postJson(REGISTER, { email, password: PASSWORD })

    const wrongPassword = await postJson(LOGIN, { email, password: `${PASSWORD}-wrong` })
    const unknownEmail = await postJson(LOGIN, { email: uniqueEmail(), password: PASSWORD })

    // Иначе ответ становится оракулом: по нему подбирают список зарегистрированных адресов.
    expect(wrongPassword.status).toBe(401)
    expect(wrongPassword.status).toBe(unknownEmail.status)
    expect(wrongPassword.body).toEqual(unknownEmail.body)
  })

  it('нечувствителен к регистру e-mail', async () => {
    const email = uniqueEmail()
    await postJson(REGISTER, { email, password: PASSWORD })

    const response = await postJson(LOGIN, { email: email.toUpperCase(), password: PASSWORD })

    expect(response.status).toBe(200)
    expectValidAuthToken(tokenOf(response.body), email)
  })

  for (const [name, payload] of invalidCredentials) {
    it(`отклоняет тело запроса: ${name}`, async () => {
      const response = await postJson(LOGIN, payload)

      expect(response.status).toBe(422)
      expect(response.body).not.toHaveProperty('token')
    })
  }
})

describe('GET /auth/me', () => {
  const secondsFromNow = (seconds: number): number => Math.floor(Date.now() / 1000) + seconds

  /** Ровно эти поля и ничего больше: клиент не должен видеть служебных колонок. */
  const ME_FIELDS = ['email', 'id']

  it('отдаёт id и e-mail владельца токена', async () => {
    const user = await registerUser()

    const response = await getJson(ME, user.token)

    expect(response.status).toBe(200)
    expect(Object.keys(response.body as object).sort()).toEqual(ME_FIELDS)

    const { id, email } = response.body as { id: string; email: string }
    expect(email).toBe(user.email)
    // id берётся из базы, а `sub` — из токена; расхождение означало бы, что
    // маршрут отвечает не про того пользователя, чей токен пришёл.
    expect(id).toBe(subjectOf(user.token))
  })

  it('не отдаёт хеш пароля и служебные отметки', async () => {
    const user = await registerUser()

    const response = await getJson(ME, user.token)

    expect(response.body).not.toHaveProperty('passwordHash')
    expect(response.body).not.toHaveProperty('password_hash')
    expect(response.body).not.toHaveProperty('createdAt')
  })

  it('отдаёт нормализованный e-mail, а не то, что прислали при регистрации', async () => {
    const email = uniqueEmail()
    const registered = await postJson(REGISTER, { email: email.toUpperCase(), password: PASSWORD })
    expect(registered.status).toBe(201)

    const response = await getJson(ME, tokenOf(registered.body))

    expect(response.status).toBe(200)
    expect((response.body as { email: string }).email).toBe(email)
  })

  it('различает пользователей: каждый видит только свой адрес', async () => {
    const first = await registerUser()
    const second = await registerUser()

    const forFirst = await getJson(ME, first.token)
    const forSecond = await getJson(ME, second.token)

    expect((forFirst.body as { email: string }).email).toBe(first.email)
    expect((forSecond.body as { email: string }).email).toBe(second.email)
  })

  it('без заголовка Authorization → 401', async () => {
    const response = await getJson(ME)

    expect(response.status).toBe(401)
    expect(response.body).not.toHaveProperty('email')
  })

  const rejectedTokens: Array<[string, string]> = [
    ['мусор вместо токена', 'not-a-jwt-at-all'],
    [
      'подпись чужим секретом',
      signJwt({ sub: randomUUID(), exp: secondsFromNow(3600) }, 'secret-from-another-service'),
    ],
    ['истёкший токен', signJwt({ sub: randomUUID(), exp: secondsFromNow(-60) }, TEST_JWT_SECRET)],
    ['подпись нашим секретом, но без sub', signJwt({ exp: secondsFromNow(3600) }, TEST_JWT_SECRET)],
  ]

  for (const [name, token] of rejectedTokens) {
    it(`отклоняет: ${name}`, async () => {
      const response = await getJson(ME, token)

      expect(response.status).toBe(401)
      expect(response.body).not.toHaveProperty('email')
    })
  }

  it('годная подпись, но такого пользователя нет → 401, а не 404', async () => {
    // Подпись наша, `sub` формата uuid — guard такой токен пропускает. Для
    // клиента это ровно та же ситуация, что истёкший токен: сессии больше нет,
    // и правило «401 → выйти и на /login» должно работать без второй ветки.
    const token = signJwt({ sub: randomUUID(), exp: secondsFromNow(3600) }, TEST_JWT_SECRET)

    const response = await getJson(ME, token)

    expect(response.status).toBe(401)
    expect(response.body).not.toHaveProperty('email')
  })
})
