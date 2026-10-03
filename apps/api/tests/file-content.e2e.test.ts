import { createHmac } from 'node:crypto'

import { describe, expect, it } from 'bun:test'

import { asFile, asFiles, createMeeting, filesPath } from './helpers/files'
import { getJson, postFile, requestRaw } from './helpers/http'
import { decodeJwt, signJwt } from './helpers/jwt'
import { registerUser } from './helpers/users'
import { TEST_JWT_SECRET } from './setup'

/**
 * Отдача файла по ссылке из списка. `<video>` и `<a href>` не умеют слать
 * `Authorization`, поэтому доступ несёт файловый токен в `?token=` — короткий,
 * на один файл и на секрете, выведенном из `JWT_SECRET`: сессионный токен не
 * должен открывать файл, а файловый — закрытые роуты.
 *
 * `Range` проверяется побайтово: плеер перематывает запросами с диапазоном, и
 * кусок «примерно того размера» ломает воспроизведение молча.
 */

/**
 * Секрет файловых ссылок тест выводит сам, а не берёт из кода: контракт — HMAC
 * от `JWT_SECRET` с меткой `file-link-v1`, и подмена его на сам `JWT_SECRET`
 * должна ронять тесты.
 */
const FILE_LINK_SECRET = createHmac('sha256', TEST_JWT_SECRET)
  .update('file-link-v1')
  .digest('base64url')

/** Срок ссылки по умолчанию — `FILE_LINK_EXPIRES_IN=15m`. */
const LINK_LIFETIME_SECONDS = 15 * 60

/** 1000 байт с узнаваемым узором: кусок по `Range` сверяется побайтово. */
const BYTES = Uint8Array.from({ length: 1000 }, (_, index) => index % 251)

const RECORDING_NAME = 'Запись планёрки 12 сентября.mp4'

const uploadRecording = async (token: string, meetingId: string, name = RECORDING_NAME) => {
  const response = await postFile(
    filesPath(meetingId),
    { name, type: 'video/mp4', body: BYTES },
    token,
  )

  expect(response.status).toBe(201)

  return asFile(response.body)
}

/** Владелец, встреча и загруженная запись — исходное состояние почти каждого теста. */
const ownerWithRecording = async () => {
  const owner = await registerUser()
  const meetingId = await createMeeting(owner.token)
  const file = await uploadRecording(owner.token, meetingId)

  return { owner, meetingId, file }
}

const bytesOf = async (response: Response): Promise<Uint8Array> =>
  new Uint8Array(await response.arrayBuffer())

const tokenOf = (url: string): string =>
  new URL(url, 'http://localhost').searchParams.get('token') ?? ''

/** Та же ссылка с другим токеном — путь остаётся, меняется только доступ. */
const withToken = (url: string, token: string): string => {
  const parsed = new URL(url, 'http://localhost')

  parsed.searchParams.set('token', token)

  return `${parsed.pathname}${parsed.search}`
}

const withRange = (range: string): RequestInit => ({ headers: { range } })

const nowSeconds = (): number => Math.floor(Date.now() / 1000)

describe('Ссылка на файл в списке', () => {
  it('у каждого файла есть url на отдачу с файловым токеном на 15 минут', async () => {
    const { owner, meetingId, file } = await ownerWithRecording()

    const [listed] = asFiles((await getJson(filesPath(meetingId), owner.token)).body)
    const url = new URL(listed?.url ?? '', 'http://localhost')

    // Путь от корня api, как и все маршруты: фронтенд склеивает его с адресом
    // api так же, как `$fetch` — свой `baseURL`.
    expect(listed?.url.startsWith('/')).toBe(true)
    expect(url.pathname).toBe(`/meetings/${meetingId}/files/${file.id}/content`)

    const token = decodeJwt(tokenOf(listed?.url ?? ''))

    expect(token.payload.sub).toBe(file.id)
    expect(token.isSignedWith(FILE_LINK_SECRET)).toBe(true)
    expect(token.isSignedWith(TEST_JWT_SECRET)).toBe(false)
    expect(Number(token.payload.exp) - Number(token.payload.iat)).toBe(LINK_LIFETIME_SECONDS)
  })

  it('загрузка отвечает тем же полем url — новый файл можно открыть без перезапроса списка', async () => {
    const { meetingId, file } = await ownerWithRecording()

    expect(new URL(file.url, 'http://localhost').pathname).toBe(
      `/meetings/${meetingId}/files/${file.id}/content`,
    )

    const response = await requestRaw(file.url)

    expect(response.status).toBe(200)
  })
})

describe('GET /meetings/:id/files/:fileId/content', () => {
  it('без Range: 200 и файл целиком, длина совпадает с размером', async () => {
    const { file } = await ownerWithRecording()

    // Заголовка Authorization нет намеренно: доступ несёт токен в ссылке.
    const response = await requestRaw(file.url)

    expect(response.status).toBe(200)
    expect(response.headers.get('content-length')).toBe(String(file.size))
    expect(response.headers.get('accept-ranges')).toBe('bytes')
    expect(response.headers.get('content-type')).toBe('video/mp4')
    expect(await bytesOf(response)).toEqual(BYTES)
  })

  it('Content-Type из метаданных и nosniff: браузер не угадывает тип по содержимому', async () => {
    const { file } = await ownerWithRecording()

    const response = await requestRaw(file.url)

    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
  })

  it('Range: bytes=0-99 → 206 и ровно 100 байт', async () => {
    const { file } = await ownerWithRecording()

    const response = await requestRaw(file.url, withRange('bytes=0-99'))

    expect(response.status).toBe(206)
    expect(response.headers.get('content-range')).toBe('bytes 0-99/1000')
    expect(response.headers.get('content-length')).toBe('100')
    // Перемотка решается по этому заголовку и в ответе на кусок тоже.
    expect(response.headers.get('accept-ranges')).toBe('bytes')
    expect(await bytesOf(response)).toEqual(BYTES.slice(0, 100))
  })

  it('bytes=900- → хвост от 900-го байта до конца', async () => {
    const { file } = await ownerWithRecording()

    const response = await requestRaw(file.url, withRange('bytes=900-'))

    expect(response.status).toBe(206)
    expect(response.headers.get('content-range')).toBe('bytes 900-999/1000')
    expect(await bytesOf(response)).toEqual(BYTES.slice(900))
  })

  it('bytes=-100 → последние 100 байт, а не первые', async () => {
    const { file } = await ownerWithRecording()

    const response = await requestRaw(file.url, withRange('bytes=-100'))

    expect(response.status).toBe(206)
    expect(response.headers.get('content-range')).toBe('bytes 900-999/1000')
    expect(await bytesOf(response)).toEqual(BYTES.slice(900))
  })

  it('конец за пределами файла обрезается по размеру', async () => {
    const { file } = await ownerWithRecording()

    const response = await requestRaw(file.url, withRange('bytes=990-5000'))

    expect(response.status).toBe(206)
    expect(response.headers.get('content-range')).toBe('bytes 990-999/1000')
    expect(await bytesOf(response)).toEqual(BYTES.slice(990))
  })

  it('начало за пределами файла → 416 и Content-Range: bytes */<размер>', async () => {
    const { file } = await ownerWithRecording()

    const response = await requestRaw(file.url, withRange('bytes=1000-1100'))

    expect(response.status).toBe(416)
    expect(response.headers.get('content-range')).toBe('bytes */1000')
  })

  // RFC 9110 разрешает игнорировать то, что не умеешь отдать: несколько
  // диапазонов и брак — это весь файл с 200, а не 400 и не сломанный плеер.
  for (const range of ['bytes=0-9,20-29', 'bytes=abc', 'items=0-9', 'bytes=50-10', 'bytes=-']) {
    it(`«${range}» → 200 и файл целиком`, async () => {
      const { file } = await ownerWithRecording()

      const response = await requestRaw(file.url, withRange(range))

      expect(response.status).toBe(200)
      expect(response.headers.get('content-range')).toBeNull()
      expect(await bytesOf(response)).toEqual(BYTES)
    })
  }

  it('Content-Disposition — attachment с исходным именем по RFC 5987', async () => {
    const { file } = await ownerWithRecording()

    const disposition = (await requestRaw(file.url)).headers.get('content-disposition') ?? ''

    expect(disposition.startsWith('attachment;')).toBe(true)

    // Современные браузеры читают `filename*`: в нём кириллица и пробелы
    // percent-encoded в UTF-8 и разворачиваются в исходное имя байт в байт.
    const encoded = /filename\*=UTF-8''([^;]+)/.exec(disposition)?.[1] ?? ''

    expect(decodeURIComponent(encoded)).toBe(RECORDING_NAME)

    // `filename=` — запасной для старых клиентов: только печатный ASCII, иначе
    // заголовок не пройдёт валидацию `Headers` вовсе.
    expect(disposition).toMatch(/filename="[\x20-\x7e]*"/)
  })
})

describe('Кто открывает файл', () => {
  it('без токена → 401', async () => {
    const { meetingId, file } = await ownerWithRecording()

    const response = await requestRaw(`/meetings/${meetingId}/files/${file.id}/content`)

    expect(response.status).toBe(401)
  })

  it('с истёкшим токеном → 401', async () => {
    const { file } = await ownerWithRecording()
    const expired = signJwt(
      { sub: file.id, iat: nowSeconds() - 3600, exp: nowSeconds() - 60 },
      FILE_LINK_SECRET,
    )

    const response = await requestRaw(withToken(file.url, expired))

    expect(response.status).toBe(401)
  })

  it('с сессионным токеном вместо файлового → 401', async () => {
    const { owner, file } = await ownerWithRecording()

    const response = await requestRaw(withToken(file.url, owner.token))

    expect(response.status).toBe(401)
  })

  it('с токеном на сам JWT_SECRET → 401: файловые ссылки подписаны своим секретом', async () => {
    const { file } = await ownerWithRecording()
    const forged = signJwt({ sub: file.id, exp: nowSeconds() + 600 }, TEST_JWT_SECRET)

    const response = await requestRaw(withToken(file.url, forged))

    expect(response.status).toBe(401)
  })

  it('с токеном соседнего файла → 401: ссылка открывает ровно свой файл', async () => {
    const { owner, meetingId, file } = await ownerWithRecording()
    const neighbour = await uploadRecording(owner.token, meetingId, 'соседняя запись.mp4')

    const response = await requestRaw(withToken(file.url, tokenOf(neighbour.url)))

    expect(response.status).toBe(401)
  })

  it('годный токен с id чужой встречи в пути → 404', async () => {
    const { file } = await ownerWithRecording()
    const stranger = await registerUser()
    const strangerMeetingId = await createMeeting(stranger.token)

    const response = await requestRaw(
      `/meetings/${strangerMeetingId}/files/${file.id}/content?token=${tokenOf(file.url)}`,
    )

    expect(response.status).toBe(404)
  })

  it('файловый токен не открывает закрытые роуты', async () => {
    const { meetingId, file } = await ownerWithRecording()
    const fileToken = tokenOf(file.url)

    // На общем секрете guard `authenticated` принял бы такой токен: `/meetings`
    // ответил бы 200 с пустым списком, `POST /meetings` — пятисоткой (ресерч, 2.3).
    for (const path of ['/auth/me', '/meetings', filesPath(meetingId)]) {
      expect((await getJson(path, fileToken)).status).toBe(401)
    }
  })
})
