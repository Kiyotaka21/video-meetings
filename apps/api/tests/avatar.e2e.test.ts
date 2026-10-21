import { randomBytes } from 'node:crypto'
import { existsSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, it } from 'bun:test'

import { prisma } from '../src/db/prisma'
import {
  AVATAR_INCOMPLETE,
  AVATAR_TOO_LARGE,
  AVATAR_UNSUPPORTED,
  MAX_AVATAR_SIZE,
} from '../src/modules/avatars/formats'
import {
  AVATAR_URL,
  avatarFileOf,
  AVATARS_DIR,
  asUser,
  currentAvatarUrl,
  imageUpload,
  putAvatar,
  storedAvatars,
  uploadAvatar,
} from './helpers/avatars'
import { messageOf } from './helpers/files'
import { getJson } from './helpers/http'
import { gif, heic, jpeg, padded, paddedStream, png, svg, text, wav, webp } from './helpers/images'
import { decodeJwt } from './helpers/jwt'
import { waitForLockWaiter } from './helpers/locks'
import { registerUser } from './helpers/users'

/**
 * Аватар, e2e через `app.handle`. Загрузка — под токеном, сырым телом, как у
 * файлов встречи; формат решают первые байты файла, а не расширение и не
 * заявленный тип. Файлы пишутся во временный `UPLOAD_DIR` из `tests/setup.ts`.
 */

const FORMATS: Array<[string, () => Uint8Array, string]> = [
  ['JPEG', jpeg, '.jpg'],
  ['PNG', png, '.png'],
  ['WebP', webp, '.webp'],
]

const userIdOf = (token: string): string => String(decodeJwt(token).payload.sub)

describe('Авторизация на /auth/me/avatar', () => {
  it('PUT без заголовка Authorization → 401, на диске ничего', async () => {
    const before = storedAvatars()

    const response = await putAvatar(imageUpload(png()))

    expect(response.status).toBe(401)
    expect(response.body).not.toHaveProperty('avatarUrl')
    expect(storedAvatars()).toEqual(before)
  })

  it('PUT с негодным токеном → 401', async () => {
    const response = await putAvatar(imageUpload(png()), 'not-a-jwt-at-all')

    expect(response.status).toBe(401)
  })
})

describe('PUT /auth/me/avatar', () => {
  for (const [name, image, extension] of FORMATS) {
    it(`${name}: 200, ссылка в /auth/me, на диске тот же файл байт в байт`, async () => {
      const user = await registerUser()
      const bytes = image()

      const response = await putAvatar(imageUpload(bytes), user.token)

      expect(response.status).toBe(200)

      const { avatarUrl } = asUser(response.body)

      // Путь от корня api: 128 бит случайного ключа в hex и расширение того
      // формата, который api узнал по содержимому.
      expect(avatarUrl).toMatch(AVATAR_URL)
      expect(avatarUrl?.endsWith(extension)).toBe(true)
      expect(await currentAvatarUrl(user.token)).toBe(avatarUrl)
      expect(await Bun.file(avatarFileOf(avatarUrl as string)).bytes()).toEqual(
        new Uint8Array(bytes),
      )
    })
  }

  it('отвечает тем же объектом, что GET /auth/me', async () => {
    // Фронтенд кладёт ответ в общий `user` без повторного запроса.
    const user = await registerUser()

    const response = await putAvatar(imageUpload(png()), user.token)
    const me = await getJson('/auth/me', user.token)

    expect(response.status).toBe(200)
    expect(response.body).toEqual(me.body)
  })

  it('формат решает содержимое: PNG с заявленным image/jpeg ложится как .png', async () => {
    const user = await registerUser()

    const response = await putAvatar(imageUpload(png(), 'image/jpeg'), user.token)

    expect(response.status).toBe(200)
    expect(asUser(response.body).avatarUrl?.endsWith('.png')).toBe(true)
  })

  it('заявленный тип не нужен вовсе: без Content-Type тоже 200', async () => {
    const user = await registerUser()
    const bytes = jpeg()

    const response = await putAvatar({ body: bytes, declaredSize: bytes.byteLength }, user.token)

    expect(response.status).toBe(200)
    expect(asUser(response.body).avatarUrl?.endsWith('.jpg')).toBe(true)
  })

  it('ключ новый на каждую загрузку, даже тех же байтов, и это не id пользователя', async () => {
    const user = await registerUser()

    const first = await uploadAvatar(user.token, png())
    const second = await uploadAvatar(user.token, png())

    // Адрес меняется при замене — на этом держится `Cache-Control: immutable`.
    expect(second).not.toBe(first)
    expect(first).not.toContain(userIdOf(user.token))
    expect(second).not.toContain(userIdOf(user.token))
  })

  it('ключ — не uuid v7: его начало не время загрузки', async () => {
    // У uuid v7 первые 48 бит — миллисекунды с эпохи: по адресу видно, когда
    // загружен аватар, и половина ключа угадывается. У случайного ключа эти
    // 48 бит попадают в минуту вокруг «сейчас» с вероятностью ~4·10⁻¹⁰.
    // Сравнивать начала двух загрузок нельзя: в 100 мс между ними у uuid v7
    // уже меняется последняя цифра метки, и такой тест его пропускает.
    const user = await registerUser()

    const url = await uploadAvatar(user.token, png())
    const leading = Number.parseInt(url.slice('/avatars/'.length, '/avatars/'.length + 12), 16)

    expect(Math.abs(leading - Date.now())).toBeGreaterThan(60_000)
  })

  it('замена: файла старого ключа на диске нет, нового — есть', async () => {
    const user = await registerUser()

    const old = await uploadAvatar(user.token, png([255, 0, 0]))
    const replaced = await uploadAvatar(user.token, png([0, 255, 0]))

    expect(existsSync(avatarFileOf(old))).toBe(false)
    expect(existsSync(avatarFileOf(replaced))).toBe(true)
    expect(await currentAvatarUrl(user.token)).toBe(replaced)
  })

  it('загрузка не трогает аватар другого пользователя', async () => {
    const owner = await registerUser()
    const stranger = await registerUser()

    const ownerAvatar = await uploadAvatar(owner.token, png())
    await uploadAvatar(stranger.token, png())
    await uploadAvatar(stranger.token, jpeg())

    expect(await currentAvatarUrl(owner.token)).toBe(ownerAvatar)
    expect(existsSync(avatarFileOf(ownerAvatar))).toBe(true)
  })
})

describe('415: формат по содержимому', () => {
  /**
   * Тип заявлен «правильный» — `image/png` у всех: проверяется, что api его не
   * слушает. Расширения в запросе нет вовсе — имени файла api не принимает.
   */
  const rejected: Array<[string, () => Uint8Array]> = [
    ['GIF', gif],
    ['SVG со скриптом', svg],
    ['HEIC', heic],
    ['текст под видом .png', text],
    ['WAV — RIFF, но не WebP', wav],
    ['обрезанная сигнатура PNG', () => png().subarray(0, 4)],
    ['пустое тело', () => new Uint8Array()],
  ]

  for (const [name, image] of rejected) {
    it(`${name} → 415 с русским текстом, на диске ничего, аватар прежний`, async () => {
      const user = await registerUser()
      const previous = await uploadAvatar(user.token, png())
      const before = storedAvatars()

      const response = await putAvatar(imageUpload(image(), 'image/png'), user.token)

      expect(response.status).toBe(415)
      expect(messageOf(response)).toBe(AVATAR_UNSUPPORTED)
      // Ни нового файла, ни `.part` — и прежний аватар на месте.
      expect(storedAvatars()).toEqual(before)
      expect(await currentAvatarUrl(user.token)).toBe(previous)
    })
  }
})

describe('413: 2 МБ по Content-Length и по факту записанных байт', () => {
  it('заявлено 2 МБ + 1 байт → 413 до чтения тела, на диске ничего', async () => {
    const user = await registerUser()
    const before = storedAvatars()

    // Тело — крошечная картинка: без проверки заголовка запрос дошёл бы до
    // сверки длины и получил бы 400 «не целиком», а не 413.
    const response = await putAvatar(
      { body: png(), type: 'image/png', declaredSize: MAX_AVATAR_SIZE + 1 },
      user.token,
    )

    expect(response.status).toBe(413)
    expect(messageOf(response)).toBe(AVATAR_TOO_LARGE)
    expect(storedAvatars()).toEqual(before)
    expect(await currentAvatarUrl(user.token)).toBeNull()
  })

  it('без Content-Length (chunked) 2 МБ + 1 байт → 413 по счётчику, .part удалён', async () => {
    const user = await registerUser()
    const previous = await uploadAvatar(user.token, png())
    const before = storedAvatars()

    const response = await putAvatar(
      { body: paddedStream(png(), MAX_AVATAR_SIZE + 1), type: 'image/png' },
      user.token,
    )

    expect(response.status).toBe(413)
    expect(messageOf(response)).toBe(AVATAR_TOO_LARGE)
    expect(storedAvatars()).toEqual(before)
    expect(await currentAvatarUrl(user.token)).toBe(previous)
  })

  it('клиент соврал в Content-Length: 413 по счётчику', async () => {
    const user = await registerUser()
    const before = storedAvatars()

    const response = await putAvatar(
      { body: paddedStream(png(), MAX_AVATAR_SIZE + 1), type: 'image/png', declaredSize: 10 },
      user.token,
    )

    expect(response.status).toBe(413)
    expect(storedAvatars()).toEqual(before)
  })

  it('ровно 2 МБ принимается: граница включительно', async () => {
    const user = await registerUser()
    const bytes = padded(png(), MAX_AVATAR_SIZE)

    const response = await putAvatar(imageUpload(bytes), user.token)

    expect(response.status).toBe(200)

    const { avatarUrl } = asUser(response.body)

    expect((await readFile(avatarFileOf(avatarUrl as string))).byteLength).toBe(MAX_AVATAR_SIZE)
  })
})

describe('Тело пришло не целиком', () => {
  it('тело короче Content-Length → 400, на диске ничего, аватар прежний', async () => {
    const user = await registerUser()
    const previous = await uploadAvatar(user.token, png())
    const before = storedAvatars()
    const bytes = jpeg()

    const response = await putAvatar(
      { body: bytes, type: 'image/jpeg', declaredSize: bytes.byteLength + 100 },
      user.token,
    )

    expect(response.status).toBe(400)
    expect(messageOf(response)).toBe(AVATAR_INCOMPLETE)
    expect(storedAvatars()).toEqual(before)
    expect(await currentAvatarUrl(user.token)).toBe(previous)
  })

  it('обрыв посреди тела: недописанный файл удалён, аватар прежний', async () => {
    const user = await registerUser()
    const previous = await uploadAvatar(user.token, png())
    const before = storedAvatars()

    // Так через `app.handle` выглядит клиент, который потерял сеть: на живом
    // сервере цикл чтения бросает `AbortError`.
    let sent = false
    const broken = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent) {
          controller.error(new Error('Соединение оборвалось'))

          return
        }

        sent = true
        controller.enqueue(png())
      },
    })

    await putAvatar({ body: broken, type: 'image/png' }, user.token)

    expect(storedAvatars()).toEqual(before)
    expect(await currentAvatarUrl(user.token)).toBe(previous)
  })
})

describe('Замена под замком строки пользователя', () => {
  /**
   * Гонка двух замен, разыгранная детерминированно (почему не `Promise.all` —
   * «Ловушки» в `apps/api/CLAUDE.md`). Соседняя загрузка уже положила свой
   * файл, держит замок на строке пользователя и записала в неё свой ключ, но
   * ещё не закоммитила. Наша загрузка встаёт за ней в очередь.
   *
   * С `FOR UPDATE` наша читает ключ после коммита соседа — его ключ — и после
   * своего коммита удаляет его файл. Без замка она прочла бы прежний ключ ещё
   * до коммита соседа, удалила бы прежний файл, а файл соседа остался бы на
   * диске без строки навсегда.
   */
  it('файл соседней загрузки, закоммиченной во время ожидания, не остаётся сиротой', async () => {
    const user = await registerUser()
    const userId = userIdOf(user.token)
    const original = await uploadAvatar(user.token, png())

    const neighbourKey = `${randomBytes(16).toString('hex')}.png`
    writeFileSync(join(AVATARS_DIR, neighbourKey), png([0, 0, 255]))

    const { promise: lockTaken, resolve: takeLock } = Promise.withResolvers<void>()
    const { promise: released, resolve: release } = Promise.withResolvers<void>()

    const neighbour = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`
      await tx.user.update({ where: { id: userId }, data: { avatarKey: neighbourKey } })
      takeLock()
      await released
    })

    await lockTaken

    const upload = putAvatar(imageUpload(jpeg()), user.token)

    await waitForLockWaiter()
    release()
    await neighbour

    // Сосед после своего коммита убирает файл, который заменил, — как это
    // делает настоящий обработчик.
    await Bun.file(avatarFileOf(original)).delete()

    const response = await upload

    expect(response.status).toBe(200)

    const ours = asUser(response.body).avatarUrl as string

    expect(await currentAvatarUrl(user.token)).toBe(ours)
    expect(existsSync(avatarFileOf(ours))).toBe(true)
    expect(existsSync(join(AVATARS_DIR, neighbourKey))).toBe(false)
  })
})
