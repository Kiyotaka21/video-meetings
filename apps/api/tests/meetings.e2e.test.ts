import { randomUUID } from 'node:crypto'

import { describe, expect, it } from 'bun:test'

import { getJson, postJson, type ApiResponse } from './helpers/http'
import { signJwt } from './helpers/jwt'
import { registerUser } from './helpers/users'
import { TEST_JWT_SECRET } from './setup'

/**
 * Контракт встреч, e2e через `app.handle`. Все три маршрута — под авторизацией:
 * без валидного Bearer-токена ни один из них ничего не отвечает по существу.
 *
 * Требует поднятой базы с накатанной схемой: `bun run db:up && bun run db:migrate`.
 */

const MEETINGS = '/meetings'

interface Meeting {
  id: string
  title: string
  date: string
  participants: string[]
  createdAt: string
}

const MEETING_FIELDS = ['createdAt', 'date', 'id', 'participants', 'title']

const meetingPayload = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  title: 'Weekly sync',
  date: '2026-03-01T10:00:00.000Z',
  participants: ['alice@example.com', 'bob@example.com'],
  ...overrides,
})

const asMeeting = (body: unknown): Meeting => {
  expect(Object.keys(body as object).sort()).toEqual(MEETING_FIELDS)
  return body as Meeting
}

const asMeetings = (body: unknown): Meeting[] => {
  expect(Array.isArray(body)).toBe(true)
  return body as Meeting[]
}

const idsOf = (body: unknown): string[] => asMeetings(body).map((meeting) => meeting.id)

/** Создаёт встречу и возвращает её же — большинству тестов нужна готовая запись. */
const createMeeting = async (token: string, overrides?: Record<string, unknown>) => {
  const response = await postJson(MEETINGS, meetingPayload(overrides), token)

  expect(response.status).toBe(201)

  return asMeeting(response.body)
}

const secondsFromNow = (seconds: number): number => Math.floor(Date.now() / 1000) + seconds

describe('Авторизация на /meetings', () => {
  /** Каждый маршрут проверяется отдельно: забыть guard легко именно на одном из них. */
  const routes: Array<[string, (token?: string) => Promise<ApiResponse>]> = [
    ['POST /meetings', (token) => postJson(MEETINGS, meetingPayload(), token)],
    ['GET /meetings', (token) => getJson(MEETINGS, token)],
    ['GET /meetings/:id', (token) => getJson(`${MEETINGS}/${randomUUID()}`, token)],
  ]

  for (const [name, call] of routes) {
    it(`${name} без заголовка Authorization → 401`, async () => {
      const response = await call()

      expect(response.status).toBe(401)
      expect(response.body).not.toHaveProperty('title')
    })
  }

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
    it(`GET /meetings отклоняет: ${name}`, async () => {
      const response = await getJson(MEETINGS, token)

      expect(response.status).toBe(401)
    })
  }
})

describe('POST /meetings', () => {
  it('создаёт встречу и возвращает её', async () => {
    const user = await registerUser()
    // Литерал, а не meetingPayload(): фабрика отдаёт Record<string, unknown>,
    // и сравнивать с её полями пришлось бы через приведение типов.
    const payload = {
      title: 'Планёрка команды',
      date: '2026-06-15T09:30:00.000Z',
      participants: ['alice@example.com', 'bob@example.com'],
    }

    const response = await postJson(MEETINGS, payload, user.token)

    expect(response.status).toBe(201)

    const meeting = asMeeting(response.body)
    expect(typeof meeting.id).toBe('string')
    expect(meeting.id).not.toBe('')
    expect(meeting.title).toBe(payload.title)
    expect(meeting.date).toBe(payload.date)
    expect(meeting.participants).toEqual(payload.participants)
  })

  it('не отдаёт наружу владельца встречи', async () => {
    const user = await registerUser()

    const response = await postJson(MEETINGS, meetingPayload(), user.token)

    expect(response.status).toBe(201)
    // Поля владельца в ответе нет: список и так отфильтрован по текущему пользователю,
    // а лишний идентификатор в теле — это утечка чужой модели наружу.
    expect(response.body).not.toHaveProperty('ownerId')
    expect(response.body).not.toHaveProperty('owner')
  })

  it('приводит дату к ISO-8601 в UTC', async () => {
    const user = await registerUser()

    const meeting = await createMeeting(user.token, { date: '2026-03-01T13:00:00+03:00' })

    expect(meeting.date).toBe('2026-03-01T10:00:00.000Z')
  })

  it('приводит участников к нижнему регистру и убирает дубли', async () => {
    const user = await registerUser()

    const meeting = await createMeeting(user.token, {
      participants: ['Alice@Example.com', 'alice@example.com', 'BOB@example.com'],
    })

    expect(meeting.participants).toEqual(['alice@example.com', 'bob@example.com'])
  })

  it('принимает пустой список участников', async () => {
    const user = await registerUser()

    const meeting = await createMeeting(user.token, { participants: [] })

    expect(meeting.participants).toEqual([])
  })

  it('выдаёт разным встречам разные id', async () => {
    const user = await registerUser()

    const first = await createMeeting(user.token)
    const second = await createMeeting(user.token)

    expect(first.id).not.toBe(second.id)
  })

  const invalidPayloads: Array<[string, unknown]> = [
    ['пустой объект', {}],
    ['без title', { date: '2026-03-01T10:00:00.000Z', participants: [] }],
    ['пустой title', meetingPayload({ title: '' })],
    ['title не строка', meetingPayload({ title: 42 })],
    ['без date', { title: 'Weekly sync', participants: [] }],
    ['date не дата', meetingPayload({ date: 'позавчера' })],
    ['date не строка', meetingPayload({ date: 1772359200000 })],
    ['без participants', { title: 'Weekly sync', date: '2026-03-01T10:00:00.000Z' }],
    ['participants не массив', meetingPayload({ participants: 'alice@example.com' })],
    ['участник не e-mail', meetingPayload({ participants: ['not-an-email'] })],
  ]

  for (const [name, payload] of invalidPayloads) {
    it(`отклоняет тело запроса: ${name}`, async () => {
      const user = await registerUser()

      const response = await postJson(MEETINGS, payload, user.token)

      expect(response.status).toBe(422)
      expect(response.body).not.toHaveProperty('id')
    })
  }
})

describe('GET /meetings', () => {
  it('у нового пользователя список пуст', async () => {
    const user = await registerUser()

    const response = await getJson(MEETINGS, user.token)

    expect(response.status).toBe(200)
    expect(response.body).toEqual([])
  })

  it('возвращает встречи текущего пользователя целиком, как их отдал POST', async () => {
    const user = await registerUser()
    const meeting = await createMeeting(user.token)

    const response = await getJson(MEETINGS, user.token)

    expect(response.status).toBe(200)
    expect(response.body).toEqual([meeting])
  })

  it('сортирует встречи по дате: ближайшие первыми', async () => {
    const user = await registerUser()
    const later = await createMeeting(user.token, { date: '2026-05-01T10:00:00.000Z' })
    const sooner = await createMeeting(user.token, { date: '2026-02-01T10:00:00.000Z' })
    const between = await createMeeting(user.token, { date: '2026-03-01T10:00:00.000Z' })

    const response = await getJson(MEETINGS, user.token)

    expect(idsOf(response.body)).toEqual([sooner.id, between.id, later.id])
  })

  it('не показывает встречи другого пользователя', async () => {
    const owner = await registerUser()
    const stranger = await registerUser()
    const meeting = await createMeeting(owner.token)

    const strangerList = await getJson(MEETINGS, stranger.token)
    const ownerList = await getJson(MEETINGS, owner.token)

    expect(strangerList.status).toBe(200)
    expect(strangerList.body).toEqual([])
    expect(idsOf(ownerList.body)).toEqual([meeting.id])
  })
})

describe('GET /meetings/:id', () => {
  it('возвращает встречу по id', async () => {
    const user = await registerUser()
    const meeting = await createMeeting(user.token)

    const response = await getJson(`${MEETINGS}/${meeting.id}`, user.token)

    expect(response.status).toBe(200)
    expect(response.body).toEqual(meeting)
  })

  it('404 на несуществующий id', async () => {
    const user = await registerUser()

    const response = await getJson(`${MEETINGS}/${randomUUID()}`, user.token)

    expect(response.status).toBe(404)
    expect(response.body).not.toHaveProperty('title')
    // Свой обработанный ответ, а не то, что вернул бы роутер на неизвестный путь.
    expect(typeof (response.body as { message?: unknown }).message).toBe('string')
  })

  it('404 на id, который не похож на идентификатор', async () => {
    const user = await registerUser()

    const response = await getJson(`${MEETINGS}/not-an-id`, user.token)

    expect(response.status).toBe(404)
    expect(typeof (response.body as { message?: unknown }).message).toBe('string')
  })

  it('404, а не 403, на чужую встречу — существование не подтверждается', async () => {
    const owner = await registerUser()
    const stranger = await registerUser()
    const meeting = await createMeeting(owner.token)

    const foreign = await getJson(`${MEETINGS}/${meeting.id}`, stranger.token)
    const missing = await getJson(`${MEETINGS}/${randomUUID()}`, stranger.token)

    expect(foreign.status).toBe(404)
    expect(foreign.body).toEqual(missing.body)
  })
})
