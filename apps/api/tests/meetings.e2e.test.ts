import { randomUUID } from 'node:crypto'

import { describe, expect, it } from 'bun:test'

import { getJson, postJson, type ApiResponse } from './helpers/http'
import { resignedGenuine, SESSION_FORGERIES } from './helpers/forgeries'
import { registerUser } from './helpers/users'

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

/** Создаёт встречу и возвращает её же — большинству тестов нужна готовая запись. */
const createMeeting = async (token: string, overrides?: Record<string, unknown>) => {
  const response = await postJson(MEETINGS, meetingPayload(overrides), token)

  expect(response.status).toBe(201)

  return asMeeting(response.body)
}

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

  // Подделки собраны из настоящего токена: 401 на них — работа проверки
  // подписи и срока, а не поиска пользователя по случайному `sub`.
  for (const [name, forge] of SESSION_FORGERIES) {
    for (const [route, call] of routes) {
      it(`${route} отклоняет: ${name}`, async () => {
        const user = await registerUser()

        const response = await call(forge(user.token))

        expect(response.status).toBe(401)
        expect(response.body).not.toHaveProperty('title')
      })
    }
  }

  it('контроль к подделкам: те же claims с нашей подписью открывают список', async () => {
    const user = await registerUser()

    const response = await getJson(MEETINGS, resignedGenuine(user.token))

    expect(response.status).toBe(200)
  })
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
    // NUL Postgres в тексте не принимает: без шаблона это была пятисотка.
    ['NUL в title', meetingPayload({ title: 'Weekly\u0000sync' })],
    ['перевод строки в title', meetingPayload({ title: 'Weekly\nsync' })],
    ['разделитель строк U+2028 в title', meetingPayload({ title: 'Weekly sync' })],
    ['title длиннее 200 символов', meetingPayload({ title: 'я'.repeat(201) })],
  ]

  it('title ровно на 200 символов, с эмодзи и кириллицей, принимается', async () => {
    const user = await registerUser()
    const title = `Планёрка 🚀 ${'я'.repeat(200 - 'Планёрка 🚀 '.length)}`

    const response = await postJson(MEETINGS, meetingPayload({ title }), user.token)

    expect(title.length).toBe(200)
    expect(response.status).toBe(201)
    expect(asMeeting(response.body).title).toBe(title)
  })

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
  const DAY = 24 * 60 * 60 * 1000

  /** Даты от «сейчас»: граница предстоящих и прошедших — часы сервера. */
  const daysFromNow = (days: number): string => new Date(Date.now() + days * DAY).toISOString()

  interface Page {
    items: Meeting[]
    total: number
    nextCursor: string | null
  }

  const pageOf = (response: ApiResponse): Page => {
    expect(response.status).toBe(200)
    expect(Object.keys(response.body as object).sort()).toEqual(['items', 'nextCursor', 'total'])

    return response.body as Page
  }

  const idsOf = (page: Page): string[] => page.items.map((meeting) => meeting.id)

  const list = (token: string, query = '') => getJson(`${MEETINGS}${query}`, token)

  /** Все страницы выборки подряд, по курсору, — как их догружает кабинет. */
  const walk = async (token: string, query: string): Promise<{ ids: string[]; pages: Page[] }> => {
    const pages: Page[] = []
    let cursor: string | null = null

    do {
      const suffix: string = cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`
      const page = pageOf(await list(token, `?${query}${suffix}`))

      pages.push(page)
      cursor = page.nextCursor
    } while (cursor !== null && pages.length < 20)

    return { ids: pages.flatMap(idsOf), pages }
  }

  it('у нового пользователя пусто: ни встреч, ни курсора', async () => {
    const user = await registerUser()

    expect(pageOf(await list(user.token))).toEqual({ items: [], total: 0, nextCursor: null })
  })

  it('по умолчанию — предстоящие, ближайшие первыми; прошедших в них нет', async () => {
    const user = await registerUser()
    const later = await createMeeting(user.token, { date: daysFromNow(30) })
    const sooner = await createMeeting(user.token, { date: daysFromNow(1) })
    await createMeeting(user.token, { date: daysFromNow(-1) })
    const between = await createMeeting(user.token, { date: daysFromNow(7) })

    const page = pageOf(await list(user.token))

    expect(idsOf(page)).toEqual([sooner.id, between.id, later.id])
    expect(page.total).toBe(3)
    expect(page.nextCursor).toBeNull()
  })

  it('встреча в списке — целиком, как её отдал POST', async () => {
    const user = await registerUser()
    const meeting = await createMeeting(user.token, { date: daysFromNow(2) })

    expect(pageOf(await list(user.token, '?scope=upcoming')).items).toEqual([meeting])
  })

  it('scope=past — прошедшие, самая свежая первой', async () => {
    const user = await registerUser()
    const oldest = await createMeeting(user.token, { date: daysFromNow(-30) })
    const freshest = await createMeeting(user.token, { date: daysFromNow(-1) })
    const between = await createMeeting(user.token, { date: daysFromNow(-7) })
    await createMeeting(user.token, { date: daysFromNow(1) })

    const page = pageOf(await list(user.token, '?scope=past'))

    expect(idsOf(page)).toEqual([freshest.id, between.id, oldest.id])
    expect(page.total).toBe(3)
  })

  it('limit режет страницу, курсор ведёт дальше без пропусков и повторов', async () => {
    const user = await registerUser()
    const created: Meeting[] = []

    for (const days of [5, 1, 4, 2, 3]) {
      created.push(await createMeeting(user.token, { date: daysFromNow(days) }))
    }

    const byDate = [...created].sort((a, b) => Date.parse(a.date) - Date.parse(b.date))
    const { ids, pages } = await walk(user.token, 'scope=upcoming&limit=2')

    expect(ids).toEqual(byDate.map((meeting) => meeting.id))
    expect(pages.map((page) => page.items.length)).toEqual([2, 2, 1])
    // `total` — вся выборка, а не страница: по нему кабинет пишет счётчик.
    expect(pages.map((page) => page.total)).toEqual([5, 5, 5])
    expect(pages.at(-1)?.nextCursor).toBeNull()
  })

  it('встречи с одной датой не теряются на стыке страниц', async () => {
    // Курсор — пара (дата, id): по одной дате одинаковые метки на границе
    // страницы выпали бы или задвоились.
    const user = await registerUser()
    const date = daysFromNow(3)
    const created = [
      await createMeeting(user.token, { date }),
      await createMeeting(user.token, { date }),
      await createMeeting(user.token, { date }),
    ]

    const { ids } = await walk(user.token, 'scope=upcoming&limit=1')

    expect(ids).toEqual(created.map((meeting) => meeting.id).sort())
  })

  it('scope=past листается тем же курсором, от свежих к старым', async () => {
    const user = await registerUser()
    const created: Meeting[] = []

    for (const days of [-3, -1, -2]) {
      created.push(await createMeeting(user.token, { date: daysFromNow(days) }))
    }

    const byDateDesc = [...created].sort((a, b) => Date.parse(b.date) - Date.parse(a.date))

    expect((await walk(user.token, 'scope=past&limit=2')).ids).toEqual(
      byDateDesc.map((meeting) => meeting.id),
    )
  })

  it('страница по умолчанию — 20 встреч', async () => {
    const user = await registerUser()

    for (let index = 0; index < 21; index += 1) {
      await createMeeting(user.token, { date: daysFromNow(index + 1) })
    }

    const page = pageOf(await list(user.token))

    expect(page.items).toHaveLength(20)
    expect(page.total).toBe(21)
    expect(page.nextCursor).not.toBeNull()
  })

  it('не показывает встречи другого пользователя', async () => {
    const owner = await registerUser()
    const stranger = await registerUser()
    const meeting = await createMeeting(owner.token, { date: daysFromNow(1) })

    expect(pageOf(await list(stranger.token)).items).toEqual([])
    expect(idsOf(pageOf(await list(owner.token)))).toEqual([meeting.id])
  })

  for (const query of ['?scope=all', '?limit=0', '?limit=101', '?limit=abc', '?limit=2.5']) {
    it(`«${query}» → 422`, async () => {
      const user = await registerUser()

      expect((await list(user.token, query)).status).toBe(422)
    })
  }

  for (const cursor of ['garbage', 'bm90LWEtY3Vyc29y', '%00']) {
    it(`битый курсор «${cursor}» → 400, а не 500`, async () => {
      const user = await registerUser()

      const response = await list(user.token, `?cursor=${cursor}`)

      expect(response.status).toBe(400)
      expect(typeof (response.body as { message?: unknown }).message).toBe('string')
    })
  }
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

  // `%00` в пути доезжал до Postgres как NUL в тексте — и запрос падал
  // пятисоткой. Id из пути сверяется с форматом uuid до базы.
  for (const id of ['not-an-id', '%00', `${randomUUID()}%00`, `${randomUUID()}x`]) {
    it(`404 на id «${id}», который не похож на идентификатор`, async () => {
      const user = await registerUser()

      const response = await getJson(`${MEETINGS}/${id}`, user.token)

      expect(response.status).toBe(404)
      expect(typeof (response.body as { message?: unknown }).message).toBe('string')
    })
  }

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
