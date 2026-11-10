import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

import { app } from '../src/app'
import { REGISTRATIONS_PER_IP } from '../src/modules/auth'
import { putAvatar } from './helpers/avatars'
import { asFile, createMeeting, filesPath } from './helpers/files'
import { jsonInit, postFile } from './helpers/http'
import { png } from './helpers/images'
import { registerUser, TEST_PASSWORD, uniqueEmail } from './helpers/users'
import { TEST_FRONTEND_ORIGIN } from './setup'

/**
 * То, чего `app.handle` не видит: Bun.serve сам решает, какую длину и какое
 * кодирование тела отправить, и переупакованный Elysia ответ на живом сервере
 * уходит chunked, хотя через `handle` заголовок на месте (ловушки в
 * `apps/api/CLAUDE.md`). Сервер — на случайном порту и только на 127.0.0.1:
 * прогон не дерётся с запущенным `bun run dev` за порт 3000.
 */

let base = ''

beforeAll(() => {
  app.listen({ hostname: '127.0.0.1', port: 0 })
  base = `http://127.0.0.1:${app.server?.port}`
})

afterAll(async () => {
  await app.stop(true)
})

const BYTES = Uint8Array.from({ length: 1000 }, (_, index) => index % 251)

const uploadedRecording = async () => {
  const owner = await registerUser()
  const meetingId = await createMeeting(owner.token)
  const response = await postFile(
    filesPath(meetingId),
    { name: 'запись.mp4', type: 'video/mp4', body: BYTES, declaredSize: BYTES.byteLength },
    owner.token,
  )

  expect(response.status).toBe(201)

  return asFile(response.body)
}

describe('Отдача файла встречи вживую', () => {
  it('200 уходит с Content-Length, а не chunked', async () => {
    // Без длины `<video>` не знает длительности, а скачивание — размера.
    const file = await uploadedRecording()

    const response = await fetch(`${base}${file.url}`)

    expect(response.status).toBe(200)
    expect(response.headers.get('content-length')).toBe('1000')
    expect(response.headers.get('transfer-encoding')).toBeNull()
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(BYTES)
  })

  for (const [range, start, end] of [
    ['bytes=0-', 0, 999],
    ['bytes=100-199', 100, 199],
    ['bytes=-10', 990, 999],
  ] as const) {
    it(`206 на «${range}» уходит с Content-Length и ровно своим куском`, async () => {
      const file = await uploadedRecording()

      const response = await fetch(`${base}${file.url}`, { headers: { range } })

      expect(response.status).toBe(206)
      expect(response.headers.get('content-length')).toBe(String(end - start + 1))
      expect(response.headers.get('content-range')).toBe(`bytes ${start}-${end}/1000`)
      expect(response.headers.get('transfer-encoding')).toBeNull()
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(BYTES.slice(start, end + 1))
    })
  }
})

describe('Аватар вживую', () => {
  it('отдаётся с Content-Length', async () => {
    const user = await registerUser()
    const uploaded = await putAvatar({ body: png(), declaredSize: png().byteLength }, user.token)
    const { avatarUrl } = uploaded.body as { avatarUrl: string }

    const response = await fetch(`${base}${avatarUrl}`)

    expect(response.status).toBe(200)
    expect(response.headers.get('content-length')).toBe(String(png().byteLength))
  })

  it('40 замен подряд — ни одной пятисотки', async () => {
    // Вживую `releaseLock()` у читателя тела ронял каждый второй PUT, а через
    // `app.handle` этого не видно (ловушки в `apps/api/CLAUDE.md`).
    const user = await registerUser()
    const statuses: number[] = []

    for (let attempt = 0; attempt < 40; attempt++) {
      const body = png()
      const response = await fetch(`${base}/auth/me/avatar`, {
        method: 'PUT',
        headers: { authorization: `Bearer ${user.token}`, 'content-type': 'image/png' },
        body,
      })

      statuses.push(response.status)
      await response.arrayBuffer()
    }

    expect(statuses.filter((status) => status !== 200)).toEqual([])
  })
})

describe('Потолок по IP вживую', () => {
  it(`после ${REGISTRATIONS_PER_IP} регистраций с одного адреса — 429 с Retry-After`, async () => {
    // Адрес клиента есть только у живого сервера: через `app.handle` потолок
    // по IP не действует. Прогон регистрирует через `handle`, поэтому весь
    // лимит адреса 127.0.0.1 достаётся этому тесту.
    const register = () =>
      fetch(
        `${base}/auth/register`,
        jsonInit('POST', { email: uniqueEmail(), password: TEST_PASSWORD }),
      )

    for (let attempt = 0; attempt < REGISTRATIONS_PER_IP; attempt++) {
      expect((await register()).status).toBe(201)
    }

    const blocked = await register()

    expect(blocked.status).toBe(429)
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0)
  })
})

describe('Потолок тела вживую', () => {
  it('chunked-тело на JSON-маршрут — 411 с CORS-заголовками', async () => {
    // Через `app.handle` chunked только изображается потоком; здесь — тело
    // без длины, каким его шлёт настоящий клиент.
    const response = await fetch(`${base}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: TEST_FRONTEND_ORIGIN },
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"email":"a@b.c","password":"12345678"}'))
          controller.close()
        },
      }),
      // Тело-поток без `duplex: 'half'` fetch не отправит.
      duplex: 'half',
    })

    expect(response.status).toBe(411)
    expect(response.headers.get('access-control-allow-origin')).toBe(TEST_FRONTEND_ORIGIN)
  })
})
