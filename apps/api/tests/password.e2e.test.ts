import { randomUUID } from 'node:crypto'

import { describe, expect, it } from 'bun:test'

import { createMeeting, filesPath, messageOf } from './helpers/files'
import { getJson, postFile, postJson, requestRaw, type ApiResponse } from './helpers/http'
import { decodeJwt, signJwt, type JwtPayload } from './helpers/jwt'
import { registerUser, TEST_PASSWORD } from './helpers/users'
import { TEST_JWT_SECRET } from './setup'

/**
 * Смена пароля и отзыв сессий, e2e через `app.handle`.
 *
 * Отзыв держится на счётчике, а не на времени: у пользователя `tokenVersion`,
 * токен несёт его в claim `ver`, guard сверяет их на каждом закрытом запросе.
 * Токен без `ver` выпущен до появления счётчика и считается версией 0 —
 * выкатка никого не разлогинивает.
 */

const ME = '/auth/me'
const PASSWORD = '/auth/me/password'
const LOGIN = '/auth/login'
const MEETINGS = '/meetings'

const NEW_PASSWORD = 'staple-battery-horse'

const secondsFromNow = (seconds: number): number => Math.floor(Date.now() / 1000) + seconds

/**
 * Пользователь со встречей и разобранным токеном: `/meetings/:id/files` нужна
 * существующая встреча, а поддельным токенам — настоящие `sub`, `iat` и `exp`.
 */
const userWithMeeting = async () => {
  const user = await registerUser()
  const meetingId = await createMeeting(user.token)
  const { payload } = decodeJwt(user.token)

  return { ...user, meetingId, payload }
}

/** Те же claims, но без `ver` — так выглядит токен, выпущенный до счётчика. */
const withoutVersion = (payload: JwtPayload): JwtPayload => {
  const claims = { ...payload }
  delete claims.ver

  return claims
}

/**
 * Закрытые маршруты трёх модулей. Guard один, но подключён в каждом модуле
 * отдельно, и забыть проверку легко именно в одном из них.
 */
const closedRoutes = (meetingId: string): string[] => [ME, MEETINGS, filesPath(meetingId)]

/** Коды ответов всех закрытых маршрутов на один токен — в одном массиве для сравнения. */
const statusesWith = (token: string, meetingId: string): Promise<number[]> =>
  Promise.all(closedRoutes(meetingId).map(async (path) => (await getJson(path, token)).status))

const ALLOWED = [200, 200, 200]
const REJECTED = [401, 401, 401]

const changePassword = (token: string | undefined, body: unknown): Promise<ApiResponse> =>
  postJson(PASSWORD, body, token)

const login = (email: string, password: string): Promise<ApiResponse> =>
  postJson(LOGIN, { email, password })

/**
 * Токен из ответа. Асимметричных матчеров нет намеренно: `toMatchObject` в bun
 * подменяет ими совпавшие поля прямо в проверяемом объекте.
 */
const tokenOf = (response: ApiResponse): string => {
  const token = (response.body as { token?: unknown }).token

  expect(typeof token).toBe('string')

  return String(token)
}

/** Смена пароля, которая обязана пройти, — исходное состояние тестов отзыва. */
const changedPassword = async (token: string): Promise<string> => {
  const response = await changePassword(token, {
    currentPassword: TEST_PASSWORD,
    newPassword: NEW_PASSWORD,
  })

  expect(response.status).toBe(200)

  return tokenOf(response)
}

describe('Версия токена в guard', () => {
  it('токен без ver — выпущенный до счётчика — проходит, пока версия пользователя 0', async () => {
    const user = await userWithMeeting()
    const legacy = signJwt(withoutVersion(user.payload), TEST_JWT_SECRET)

    expect(await statusesWith(legacy, user.meetingId)).toEqual(ALLOWED)
  })

  it('ver не совпал с версией пользователя → 401 на всех закрытых маршрутах', async () => {
    const user = await userWithMeeting()
    const ahead = signJwt({ ...user.payload, ver: 1 }, TEST_JWT_SECRET)

    expect(await statusesWith(ahead, user.meetingId)).toEqual(REJECTED)
  })

  it('ver строкой → 401: "0" — это не версия 0', async () => {
    const user = await userWithMeeting()
    const stringly = signJwt({ ...user.payload, ver: '0' }, TEST_JWT_SECRET)

    expect(await statusesWith(stringly, user.meetingId)).toEqual(REJECTED)
  })

  it('годная подпись, но пользователя нет → 401 везде, а не пустой список встреч', async () => {
    // Раньше guard проверял только подпись: `GET /meetings` с таким токеном
    // отвечал 200 и пустым списком, `POST /meetings` — пятисоткой на внешнем
    // ключе. Теперь guard читает строку пользователя и отвечает 401 сам.
    const { meetingId } = await userWithMeeting()
    const orphan = signJwt(
      { sub: randomUUID(), ver: 0, exp: secondsFromNow(3600) },
      TEST_JWT_SECRET,
    )

    expect(await statusesWith(orphan, meetingId)).toEqual(REJECTED)
  })
})

describe('POST /auth/me/password', () => {
  it('с верным текущим паролем — 200 и { token } с версией на единицу больше', async () => {
    const user = await userWithMeeting()

    const response = await changePassword(user.token, {
      currentPassword: TEST_PASSWORD,
      newPassword: NEW_PASSWORD,
    })

    expect(response.status).toBe(200)
    // Только токен: ни хеша, ни самого пароля в ответе быть не должно.
    expect(Object.keys(response.body as object)).toEqual(['token'])
    expect(response.raw).not.toContain(NEW_PASSWORD)

    const { payload, isSignedWith } = decodeJwt(tokenOf(response))
    expect(isSignedWith(TEST_JWT_SECRET)).toBe(true)
    expect(payload.sub).toBe(user.payload.sub)
    expect(payload.email).toBe(user.email)
    expect(payload.ver).toBe(1)
  })

  it('после смены вход со старым паролем — 401, с новым — 200', async () => {
    const user = await registerUser()
    await changedPassword(user.token)

    expect((await login(user.email, TEST_PASSWORD)).status).toBe(401)
    expect((await login(user.email, NEW_PASSWORD)).status).toBe(200)
  })

  it('неверный текущий пароль — 403 с текстом, и не меняется ничего', async () => {
    const user = await userWithMeeting()

    const response = await changePassword(user.token, {
      currentPassword: `${TEST_PASSWORD}-wrong`,
      newPassword: NEW_PASSWORD,
    })

    // Не 401: на фронтенде он значит «сессия кончилась», и опечатка в поле
    // формы выкинула бы пользователя из системы.
    expect(response.status).toBe(403)
    expect(messageOf(response)).toBe('Текущий пароль неверен')
    expect(response.body).not.toHaveProperty('token')

    expect((await login(user.email, TEST_PASSWORD)).status).toBe(200)
    expect((await login(user.email, NEW_PASSWORD)).status).toBe(401)
    expect(await statusesWith(user.token, user.meetingId)).toEqual(ALLOWED)
  })

  it('новый пароль совпадает с текущим — 400 с текстом, сессии живы', async () => {
    const user = await userWithMeeting()

    const response = await changePassword(user.token, {
      currentPassword: TEST_PASSWORD,
      newPassword: TEST_PASSWORD,
    })

    expect(response.status).toBe(400)
    expect(messageOf(response)).toBe('Новый пароль совпадает с текущим')
    expect(response.body).not.toHaveProperty('token')
    expect(await statusesWith(user.token, user.meetingId)).toEqual(ALLOWED)
  })

  it('неверный текущий, совпавший с новым, — 403, а не «совпадает с текущим»', async () => {
    // Сравнивать поля друг с другом раньше проверки текущего пароля нельзя:
    // ответ «совпадает с текущим» на неверный текущий был бы неправдой.
    const user = await registerUser()
    const wrong = `${TEST_PASSWORD}-wrong`

    const response = await changePassword(user.token, {
      currentPassword: wrong,
      newPassword: wrong,
    })

    expect(response.status).toBe(403)
  })

  /** Тела, которые обязан отбить валидатор: пароль после них прежний. */
  const rejectedBodies: Array<[string, unknown]> = [
    ['новый на 7 символов', { currentPassword: TEST_PASSWORD, newPassword: 'p'.repeat(7) }],
    ['новый на 129 символов', { currentPassword: TEST_PASSWORD, newPassword: 'p'.repeat(129) }],
    // Пароля вне 8–128 нет ни у кого: так же его отбивает и вход.
    ['текущий на 7 символов', { currentPassword: 'p'.repeat(7), newPassword: NEW_PASSWORD }],
    ['текущий на 129 символов', { currentPassword: 'p'.repeat(129), newPassword: NEW_PASSWORD }],
    ['без нового', { currentPassword: TEST_PASSWORD }],
    ['без текущего', { newPassword: NEW_PASSWORD }],
    ['новый не строка', { currentPassword: TEST_PASSWORD, newPassword: 12345678 }],
  ]

  for (const [label, body] of rejectedBodies) {
    it(`отклоняет: ${label} — 422, пароль прежний`, async () => {
      const user = await registerUser()

      const response = await changePassword(user.token, body)

      expect(response.status).toBe(422)
      expect(response.body).not.toHaveProperty('token')
      expect((await login(user.email, TEST_PASSWORD)).status).toBe(200)
    })
  }

  const acceptedLengths = [8, 128]

  for (const length of acceptedLengths) {
    it(`новый пароль ровно на ${length} символов принимает: граница та же, что у регистрации`, async () => {
      const user = await registerUser()
      const newPassword = 'p'.repeat(length)

      const response = await changePassword(user.token, {
        currentPassword: TEST_PASSWORD,
        newPassword,
      })

      expect(response.status).toBe(200)
      expect((await login(user.email, newPassword)).status).toBe(200)
    })
  }

  it('без заголовка Authorization → 401', async () => {
    const response = await changePassword(undefined, {
      currentPassword: TEST_PASSWORD,
      newPassword: NEW_PASSWORD,
    })

    expect(response.status).toBe(401)
    expect(response.body).not.toHaveProperty('token')
  })

  it('с негодным токеном → 401', async () => {
    const response = await changePassword('not-a-jwt-at-all', {
      currentPassword: TEST_PASSWORD,
      newPassword: NEW_PASSWORD,
    })

    expect(response.status).toBe(401)
  })

  it('в спеке OpenAPI закрыт bearerAuth и описывает 200, 400, 401 и 403', async () => {
    type Spec = {
      paths: Record<string, Record<string, { security?: unknown; responses?: object }>>
    }

    const response = await getJson('/docs/json')
    const operation = (response.body as Spec).paths[PASSWORD]?.post

    expect(response.status).toBe(200)
    expect(operation?.security).toEqual([{ bearerAuth: [] }])
    // Пустой список недостающих кодов — так в отказе видно, какого именно нет.
    const documented = Object.keys(operation?.responses ?? {})
    const missing = ['200', '400', '401', '403'].filter((code) => !documented.includes(code))

    expect(missing).toEqual([])
  })
})

describe('Отзыв сессий после смены пароля', () => {
  it('токен, с которым меняли пароль, — 401 на всех закрытых маршрутах, новый — 200', async () => {
    const user = await userWithMeeting()

    const fresh = await changedPassword(user.token)

    expect(await statusesWith(user.token, user.meetingId)).toEqual(REJECTED)
    expect(await statusesWith(fresh, user.meetingId)).toEqual(ALLOWED)
  })

  it('токен входа с другого устройства, выпущенный до смены, — тоже 401', async () => {
    const user = await userWithMeeting()
    const otherDevice = tokenOf(await login(user.email, TEST_PASSWORD))

    await changedPassword(user.token)

    expect(await statusesWith(otherDevice, user.meetingId)).toEqual(REJECTED)
  })

  it('токен без ver, выпущенный до счётчика, после первой смены — 401', async () => {
    const user = await userWithMeeting()
    const legacy = signJwt(withoutVersion(user.payload), TEST_JWT_SECRET)

    await changedPassword(user.token)

    expect(await statusesWith(legacy, user.meetingId)).toEqual(REJECTED)
  })

  it('вход после смены выдаёт токен новой версии, и он проходит', async () => {
    const user = await userWithMeeting()
    await changedPassword(user.token)

    const token = tokenOf(await login(user.email, NEW_PASSWORD))

    expect(decodeJwt(token).payload.ver).toBe(1)
    expect(await statusesWith(token, user.meetingId)).toEqual(ALLOWED)
  })

  it('вторая смена снова поднимает версию и отзывает токен первой', async () => {
    const user = await userWithMeeting()
    const first = await changedPassword(user.token)

    const response = await changePassword(first, {
      currentPassword: NEW_PASSWORD,
      newPassword: TEST_PASSWORD,
    })

    expect(response.status).toBe(200)

    const second = tokenOf(response)
    expect(decodeJwt(second).payload.ver).toBe(2)
    expect(await statusesWith(first, user.meetingId)).toEqual(REJECTED)
    expect(await statusesWith(second, user.meetingId)).toEqual(ALLOWED)
  })

  it('край одной секунды: тот же iat, что у нового токена, но прежняя версия — 401', async () => {
    // Ради этого случая отзыв и сделан счётчиком. `iat` точен до секунды, и
    // токен, выпущенный за мгновение до смены, по времени неотличим от
    // нового: схема «iat раньше смены — отказ» либо пропустила бы его, либо
    // отбила бы и новый. Здесь все claims — sub, email, iat, exp — взяты у
    // нового токена, отличается только версия.
    const user = await userWithMeeting()
    const fresh = await changedPassword(user.token)
    const { payload } = decodeJwt(fresh)

    const sameSecond = signJwt({ ...payload, ver: user.payload.ver }, TEST_JWT_SECRET)
    const sameSecondLegacy = signJwt(withoutVersion(payload), TEST_JWT_SECRET)
    // Контроль: собранный тем же хелпером токен с новой версией проходит —
    // значит, 401 выше из-за версии, а не из-за того, как собран токен.
    const control = signJwt({ ...payload }, TEST_JWT_SECRET)

    expect(typeof payload.iat).toBe('number')
    expect(await statusesWith(sameSecond, user.meetingId)).toEqual(REJECTED)
    expect(await statusesWith(sameSecondLegacy, user.meetingId)).toEqual(REJECTED)
    expect(await statusesWith(control, user.meetingId)).toEqual(ALLOWED)
    expect(await statusesWith(fresh, user.meetingId)).toEqual(ALLOWED)
  })

  it('ссылка на файл, выданная до смены, доживает свой срок: файловые токены не отзываются', async () => {
    // Решение PRD: ссылка подписана своим секретом и живёт 15 минут, а отзыв
    // потребовал бы похода в базу на каждую отдачу. Новую ссылку старый токен
    // уже не получит — список файлов закрыт guard'ом (см. тесты выше).
    const user = await userWithMeeting()
    const upload = await postFile(
      filesPath(user.meetingId),
      { name: 'notes.md', type: 'text/markdown', body: 'notes before the change' },
      user.token,
    )
    expect(upload.status).toBe(201)

    await changedPassword(user.token)

    const response = await requestRaw((upload.body as { url: string }).url)

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('notes before the change')
  })
})
