import { randomUUID } from 'node:crypto'

import { describe, expect, it } from 'bun:test'

import { createMeeting, filesPath } from './helpers/files'
import { getJson } from './helpers/http'
import { decodeJwt, signJwt, type JwtPayload } from './helpers/jwt'
import { registerUser } from './helpers/users'
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
const MEETINGS = '/meetings'

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
