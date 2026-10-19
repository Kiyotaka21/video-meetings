import { randomUUID } from 'node:crypto'

import { describe, expect, it } from 'bun:test'

import { getJson, patchJson, postJson } from './helpers/http'
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

const secondsFromNow = (seconds: number): number => Math.floor(Date.now() / 1000) + seconds

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

/**
 * Токены, которые обязан отбить guard. Набор один на GET и PATCH `/auth/me`:
 * без проверки `sub` в guard'е токен без него дошёл бы до `update` с
 * `id: undefined` и вместо 401 получил бы 500.
 */
const rejectedTokens: Array<[string, string]> = [
  ['мусор вместо токена', 'not-a-jwt-at-all'],
  [
    'подпись чужим секретом',
    signJwt({ sub: randomUUID(), exp: secondsFromNow(3600) }, 'secret-from-another-service'),
  ],
  ['истёкший токен', signJwt({ sub: randomUUID(), exp: secondsFromNow(-60) }, TEST_JWT_SECRET)],
  ['подпись нашим секретом, но без sub', signJwt({ exp: secondsFromNow(3600) }, TEST_JWT_SECRET)],
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
  /** Ровно эти поля и ничего больше: клиент не должен видеть служебных колонок. */
  const ME_FIELDS = ['email', 'id', 'name']

  it('отдаёт id, e-mail и имя владельца токена', async () => {
    const user = await registerUser()

    const response = await getJson(ME, user.token)

    expect(response.status).toBe(200)
    expect(Object.keys(response.body as object).sort()).toEqual(ME_FIELDS)

    const { id, email, name } = response.body as { id: string; email: string; name: unknown }
    expect(email).toBe(user.email)
    // id берётся из базы, а `sub` — из токена; расхождение означало бы, что
    // маршрут отвечает не про того пользователя, чей токен пришёл.
    expect(id).toBe(subjectOf(user.token))
    // При регистрации имя не спрашивается. Поле при этом есть всегда: `null`
    // значит «не задано», и клиенту не нужно отличать его от пропавшего ключа.
    expect(name).toBeNull()
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

describe('PATCH /auth/me', () => {
  const NAME = 'Анна Петрова'

  /** Имя, каким его теперь видит `GET /auth/me`, — не то, что вернул сам PATCH. */
  const storedNameOf = async (token: string): Promise<unknown> => {
    const response = await getJson(ME, token)

    expect(response.status).toBe(200)
    expect(response.body).toHaveProperty('name')

    return (response.body as { name: unknown }).name
  }

  const nameIn = (body: unknown): unknown => (body as { name?: unknown }).name

  /** Пользователь, у которого имя уже задано: отказ обязан оставить его прежним. */
  const userNamed = async (name: string) => {
    const user = await registerUser()
    const response = await patchJson(ME, { name }, user.token)

    expect(response.status).toBe(200)

    return user
  }

  it('обрезает пробелы по краям: «  Анна Петрова  » сохраняется как «Анна Петрова»', async () => {
    const user = await registerUser()

    const response = await patchJson(ME, { name: `  ${NAME}  ` }, user.token)

    expect(response.status).toBe(200)
    expect(nameIn(response.body)).toBe(NAME)
    expect(await storedNameOf(user.token)).toBe(NAME)
  })

  it('отвечает тем же объектом, что GET /auth/me', async () => {
    // Фронтенд кладёт ответ в общий `user` без повторного запроса, поэтому
    // поля и значения обязаны совпасть целиком, а не только имя.
    const user = await registerUser()

    const patched = await patchJson(ME, { name: NAME }, user.token)
    const me = await getJson(ME, user.token)

    expect(patched.status).toBe(200)
    expect(patched.body).toEqual(me.body)
  })

  const resets: Array<[string, string]> = [
    ['пустая строка', ''],
    ['одни пробелы', '   '],
  ]

  for (const [label, name] of resets) {
    it(`${label} сбрасывает имя в null`, async () => {
      const user = await userNamed(NAME)

      const response = await patchJson(ME, { name }, user.token)

      expect(response.status).toBe(200)
      expect(nameIn(response.body)).toBeNull()
      expect(await storedNameOf(user.token)).toBeNull()
    })
  }

  it('50 символов принимает, и пробелы по краям в границу не входят', async () => {
    const name = 'я'.repeat(50)
    const user = await registerUser()

    const response = await patchJson(ME, { name: `  ${name}  ` }, user.token)

    expect(response.status).toBe(200)
    expect(nameIn(response.body)).toBe(name)
  })

  it('правит имя только владельцу токена', async () => {
    const owner = await registerUser()
    const neighbour = await registerUser()

    const response = await patchJson(ME, { name: NAME }, owner.token)

    expect(response.status).toBe(200)
    expect(await storedNameOf(neighbour.token)).toBeNull()
  })

  /** Тела, которые обязан отбить валидатор, не трогая сохранённое имя. */
  const rejectedBodies: Array<[string, unknown]> = [
    ['51 символ', { name: 'я'.repeat(51) }],
    ['51 символ даже с пробелами по краям', { name: ` ${'я'.repeat(51)} ` }],
    ['перевод строки внутри', { name: 'Анна\nПетрова' }],
    // `trim()` срезал бы его молча, но перевод строки не принимается нигде.
    ['перевод строки по краю', { name: 'Анна\n' }],
    ['возврат каретки', { name: 'Анна\rПетрова' }],
    ['табуляция', { name: 'Анна\tПетрова' }],
    ['нулевой символ', { name: 'Анна\u0000' }],
    ['DEL', { name: 'Анна\u007F' }],
    ['C1-управляющий', { name: 'Анна\u0085Петрова' }],
    ['разделитель строк U+2028', { name: 'Анна\u2028Петрова' }],
    ['разделитель абзацев U+2029', { name: 'Анна\u2029Петрова' }],
    ['имя не строка', { name: 42 }],
    ['без поля name', {}],
  ]

  for (const [label, payload] of rejectedBodies) {
    it(`отклоняет: ${label} — 422, имя прежнее`, async () => {
      const user = await userNamed(NAME)

      const response = await patchJson(ME, payload, user.token)

      expect(response.status).toBe(422)
      expect(await storedNameOf(user.token)).toBe(NAME)
    })
  }

  it('без заголовка Authorization → 401', async () => {
    const response = await patchJson(ME, { name: NAME })

    expect(response.status).toBe(401)
    expect(response.body).not.toHaveProperty('name')
  })

  for (const [name, token] of rejectedTokens) {
    it(`отклоняет: ${name} → 401`, async () => {
      const response = await patchJson(ME, { name: NAME }, token)

      expect(response.status).toBe(401)
      expect(response.body).not.toHaveProperty('name')
    })
  }

  it('годная подпись, но такого пользователя нет → 401, а не 404 и не 500', async () => {
    // `update` по несуществующей строке бросает P2025; наружу это та же
    // мёртвая сессия, что и на GET /auth/me.
    const token = signJwt({ sub: randomUUID(), exp: secondsFromNow(3600) }, TEST_JWT_SECRET)

    const response = await patchJson(ME, { name: NAME }, token)

    expect(response.status).toBe(401)
    expect(response.body).not.toHaveProperty('name')
  })

  it('в спеке OpenAPI закрыт bearerAuth и описывает 401', async () => {
    // Без `detail.security` в Scalar нет поля для токена и роут выглядит
    // открытым; без 401 в `response`-карте guard не опишет свой отказ.
    type Spec = {
      paths: Record<string, Record<string, { security?: unknown; responses?: object }>>
    }

    const response = await getJson('/docs/json')
    const operation = (response.body as Spec).paths[ME]?.patch

    expect(response.status).toBe(200)
    expect(operation?.security).toEqual([{ bearerAuth: [] }])
    expect(Object.keys(operation?.responses ?? {})).toContain('401')
  })
})
