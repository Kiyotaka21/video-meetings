import { randomBytes, randomUUID } from 'node:crypto'
import { existsSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { describe, expect, it } from 'bun:test'

import { prisma } from '../src/db/prisma'
import {
  AVATAR_FORMATS,
  AVATAR_INCOMPLETE,
  AVATAR_TOO_LARGE,
  AVATAR_UNSUPPORTED,
  MAX_AVATAR_SIZE,
} from '../src/modules/avatars/formats'
import {
  AVATAR_PATH,
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
import { deleteJson, getJson, postJson, requestRaw } from './helpers/http'
import { gif, heic, jpeg, padded, paddedStream, png, svg, text, wav, webp } from './helpers/images'
import { decodeJwt, signJwt } from './helpers/jwt'
import { waitForLockWaiter } from './helpers/locks'
import { registerUser, TEST_PASSWORD } from './helpers/users'
import { TEST_JWT_SECRET } from './setup'

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

const secondsFromNow = (seconds: number): number => Math.floor(Date.now() / 1000) + seconds

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

  it('DELETE без заголовка Authorization → 401', async () => {
    const response = await deleteJson(AVATAR_PATH)

    expect(response.status).toBe(401)
    expect(response.body).not.toHaveProperty('avatarUrl')
  })

  it('DELETE с негодным токеном → 401, аватар на месте', async () => {
    const user = await registerUser()
    const avatar = await uploadAvatar(user.token, png())

    const response = await deleteJson(AVATAR_PATH, 'not-a-jwt-at-all')

    expect(response.status).toBe(401)
    expect(await currentAvatarUrl(user.token)).toBe(avatar)
  })

  /**
   * Токены, которые обязан отбить guard. Тело PUT до записи не доходит —
   * на диске после отказа ничего, — а DELETE не трогает чужой аватар.
   */
  const rejectedTokens: Array<[string, () => string]> = [
    [
      'подпись чужим секретом',
      () => signJwt({ sub: randomUUID(), exp: secondsFromNow(3600) }, 'another-secret'),
    ],
    ['истёкший', () => signJwt({ sub: randomUUID(), exp: secondsFromNow(-60) }, TEST_JWT_SECRET)],
    ['без sub', () => signJwt({ exp: secondsFromNow(3600) }, TEST_JWT_SECRET)],
    [
      'годная подпись, а пользователя нет',
      () => signJwt({ sub: randomUUID(), exp: secondsFromNow(3600) }, TEST_JWT_SECRET),
    ],
  ]

  for (const [name, token] of rejectedTokens) {
    it(`PUT и DELETE отклоняют токен: ${name} → 401, на диске ничего`, async () => {
      const before = storedAvatars()

      const put = await putAvatar(imageUpload(png()), token())
      const removed = await deleteJson(AVATAR_PATH, token())

      expect(put.status).toBe(401)
      expect(removed.status).toBe(401)
      expect(storedAvatars()).toEqual(before)
    })
  }

  it('токен, выпущенный до смены пароля, — 401 на PUT и DELETE, аватар прежний', async () => {
    // Guard сверяет версию сессий: загрузка и удаление аватара — такие же
    // закрытые маршруты, как `/auth/me` и `/meetings`.
    const user = await registerUser()
    const avatar = await uploadAvatar(user.token, png())

    const changed = await postJson(
      '/auth/me/password',
      { currentPassword: TEST_PASSWORD, newPassword: 'staple-battery-horse' },
      user.token,
    )
    const fresh = (changed.body as { token: string }).token

    expect(changed.status).toBe(200)
    expect((await putAvatar(imageUpload(jpeg()), user.token)).status).toBe(401)
    expect((await deleteJson(AVATAR_PATH, user.token)).status).toBe(401)
    expect(await currentAvatarUrl(fresh)).toBe(avatar)
    expect(existsSync(avatarFileOf(avatar))).toBe(true)
  })

  for (const method of ['put', 'delete'] as const) {
    it(`в спеке OpenAPI ${method.toUpperCase()} закрыт bearerAuth и описывает 401`, async () => {
      // Без `detail.security` в Scalar нет поля для токена и роут выглядит
      // открытым; без 401 в `response`-карте guard не опишет свой отказ.
      type Spec = {
        paths: Record<string, Record<string, { security?: unknown; responses?: object }>>
      }

      const response = await getJson('/docs/json')
      const operation = (response.body as Spec).paths[AVATAR_PATH]?.[method]

      expect(operation?.security).toEqual([{ bearerAuth: [] }])
      expect(Object.keys(operation?.responses ?? {})).toContain('401')
    })
  }
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

  it('замена: файла старого ключа на диске нет, его адрес — 404, новый отдаётся', async () => {
    const user = await registerUser()
    const replacement = png([0, 255, 0])

    const old = await uploadAvatar(user.token, png([255, 0, 0]))
    const replaced = await uploadAvatar(user.token, replacement)

    expect(existsSync(avatarFileOf(old))).toBe(false)
    expect(existsSync(avatarFileOf(replaced))).toBe(true)
    expect(await currentAvatarUrl(user.token)).toBe(replaced)

    expect((await requestRaw(old)).status).toBe(404)

    const fresh = await requestRaw(replaced)

    expect(fresh.status).toBe(200)
    expect(await fresh.bytes()).toEqual(new Uint8Array(replacement))
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

  /**
   * Тот же приём для окна между guard'ом и транзакцией: guard пользователя
   * уже нашёл, файл уже лёг под новым ключом, а строку удаляют, пока загрузка
   * ждёт замка. Для клиента это мёртвая сессия — 401, — а файл без строки
   * обработчик обязан убрать сам: больше его не подберёт никто.
   */
  it('пользователя удалили, пока загрузка ждала замка: 401, нового файла на диске нет', async () => {
    const user = await registerUser()
    const userId = userIdOf(user.token)
    const before = storedAvatars()

    const { promise: lockTaken, resolve: takeLock } = Promise.withResolvers<void>()
    const { promise: released, resolve: release } = Promise.withResolvers<void>()

    const neighbour = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`
      await tx.user.delete({ where: { id: userId } })
      takeLock()
      await released
    })

    await lockTaken

    const upload = putAvatar(imageUpload(png()), user.token)

    await waitForLockWaiter()
    release()
    await neighbour

    const response = await upload

    expect(response.status).toBe(401)
    expect(storedAvatars()).toEqual(before)
  })
})

describe('DELETE /auth/me/avatar', () => {
  it('отвечает пользователем с avatarUrl: null, файла нет, старый адрес — 404', async () => {
    const user = await registerUser()
    const avatar = await uploadAvatar(user.token, png())

    const response = await deleteJson(AVATAR_PATH, user.token)

    expect(response.status).toBe(200)
    expect(asUser(response.body).avatarUrl).toBeNull()
    expect(await currentAvatarUrl(user.token)).toBeNull()
    expect(existsSync(avatarFileOf(avatar))).toBe(false)
    expect((await requestRaw(avatar)).status).toBe(404)
  })

  it('отвечает тем же объектом, что GET /auth/me', async () => {
    const user = await registerUser()
    await uploadAvatar(user.token, webp())

    const response = await deleteJson(AVATAR_PATH, user.token)
    const me = await getJson('/auth/me', user.token)

    expect(response.body).toEqual(me.body)
  })

  it('без аватара — тоже 200 и null: удалять нечего, цель достигнута', async () => {
    // Второй клик или вкладка, где аватар уже удалили, не должны получать
    // ошибку на то, чего и хотели.
    const user = await registerUser()

    const response = await deleteJson(AVATAR_PATH, user.token)

    expect(response.status).toBe(200)
    expect(asUser(response.body).avatarUrl).toBeNull()
  })

  it('удаляет только свой аватар', async () => {
    const owner = await registerUser()
    const stranger = await registerUser()
    const ownerAvatar = await uploadAvatar(owner.token, png())
    await uploadAvatar(stranger.token, png())

    await deleteJson(AVATAR_PATH, stranger.token)

    expect(await currentAvatarUrl(owner.token)).toBe(ownerAvatar)
    expect((await requestRaw(ownerAvatar)).status).toBe(200)
  })
})

describe('GET /avatars/:file', () => {
  for (const [name, image] of FORMATS) {
    it(`${name}: без токена, те же байты и Content-Type формата`, async () => {
      const user = await registerUser()
      const bytes = image()
      const format = AVATAR_FORMATS.find((candidate) => candidate.matches(bytes))
      const avatar = await uploadAvatar(user.token, bytes)

      const response = await requestRaw(avatar)

      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toBe(format?.mimeType ?? '')
      expect(response.headers.get('content-length')).toBe(String(bytes.byteLength))
      expect(await response.bytes()).toEqual(new Uint8Array(bytes))
    })
  }

  it('заголовки: nosniff, кэш навсегда, картинку можно встраивать с чужого origin', async () => {
    const user = await registerUser()
    const avatar = await uploadAvatar(user.token, png())

    const response = await requestRaw(avatar)

    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    // Адрес меняется при каждой замене, поэтому картинку по нему можно не
    // перепроверять никогда — даже при обновлении страницы.
    expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
    // `<img>` на фронтенде — другой origin (5173 против 3000).
    expect(response.headers.get('cross-origin-resource-policy')).toBe('cross-origin')
  })

  it('Content-Type — по формату, а не по заявленному при загрузке', async () => {
    const user = await registerUser()
    const avatar = asUser((await putAvatar(imageUpload(png(), 'text/html'), user.token)).body)
      .avatarUrl as string

    const response = await requestRaw(avatar)

    expect(response.headers.get('content-type')).toBe('image/png')
  })

  it('/avatars/<id пользователя> и /avatars/<id>.png — 404: адрес из id не составить', async () => {
    const user = await registerUser()
    await uploadAvatar(user.token, png())
    const id = userIdOf(user.token)

    for (const path of [`/avatars/${id}`, `/avatars/${id}.png`]) {
      const response = await requestRaw(path)

      expect(response.status).toBe(404)
      expect(response.headers.get('content-type')).not.toStartWith('image/')
    }
  })

  it('ключ есть в базе, но адрес чуть другой — 404', async () => {
    const user = await registerUser()
    const avatar = await uploadAvatar(user.token, png())
    const key = avatar.slice('/avatars/'.length, -'.png'.length)

    const lookalikes = [
      `/avatars/${key}`, // без расширения
      `/avatars/${key}.jpg`, // чужое расширение
      `/avatars/${key}.PNG`, // регистр: на Windows это тот же файл на диске
      `/avatars/${key.toUpperCase()}.png`,
      `/avatars/${key}.png.part`,
      `/avatars/${key}.png%00.jpg`,
    ]

    for (const path of lookalikes) {
      expect({ path, status: (await requestRaw(path)).status }).toEqual({ path, status: 404 })
    }
  })

  it('путь не выходит за каталог аватаров: ..%2F — 404', async () => {
    // Файл, который отдала бы отдача, собирающая путь из адреса без проверки.
    writeFileSync(join(AVATARS_DIR, '..', 'outside.png'), png())

    for (const path of ['/avatars/..%2Foutside.png', '/avatars/%2E%2E%2Foutside.png']) {
      expect({ path, status: (await requestRaw(path)).status }).toEqual({ path, status: 404 })
    }
  })

  it('файл на диске есть, а строки нет — 404', async () => {
    // Например, файл от загрузки, чья транзакция не прошла, или подобранный
    // ключ: отдаёт только то, на что указывает строка пользователя.
    const orphan = `${randomBytes(16).toString('hex')}.png`
    writeFileSync(join(AVATARS_DIR, orphan), png())

    const response = await requestRaw(`/avatars/${orphan}`)

    expect(response.status).toBe(404)
  })

  it('строка есть, а файла нет — 404, а не пустой 200', async () => {
    // `Bun.file` на несуществующий путь даёт размер 0 и пустое тело без
    // ошибки: без проверки на диске рассинхрон выглядел бы «успешной» пустой
    // картинкой.
    const user = await registerUser()
    const avatar = await uploadAvatar(user.token, png())
    await Bun.file(avatarFileOf(avatar)).delete()

    const response = await requestRaw(avatar)

    expect(response.status).toBe(404)
  })

  it('отказ не кэшируется навсегда', async () => {
    // Иначе адрес, по которому однажды ответили 404, браузер не перепросил бы
    // никогда.
    const response = await requestRaw(`/avatars/${randomBytes(16).toString('hex')}.png`)

    expect(response.status).toBe(404)
    expect(response.headers.get('cache-control') ?? '').not.toContain('immutable')
  })
})
