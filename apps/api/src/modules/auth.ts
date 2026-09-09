import { jwt } from '@elysiajs/jwt'
import { Elysia, t } from 'elysia'

import { env } from '../config/env'
import { prisma } from '../db/prisma'

const credentials = t.Object({
  email: t.String({ format: 'email', minLength: 3, maxLength: 254 }),
  password: t.String({ minLength: 8, maxLength: 128 }),
})

const tokenResponse = t.Object({ token: t.String() })
const messageResponse = t.Object({ message: t.String() })

/**
 * Один и тот же ответ на «нет такого пользователя» и «неверный пароль»: разные
 * ответы превращают логин в оракул, по которому перебирают зарегистрированные
 * адреса.
 */
const INVALID_CREDENTIALS = { message: 'Invalid email or password' } as const

/**
 * Хеш случайной строки, которую никто не знает. Сверяем пароль с ним, когда
 * пользователь не найден: без этого ответ на неизвестный e-mail возвращается
 * заметно быстрее, чем на неверный пароль, и тот же перебор идёт по таймингам.
 */
const ABSENT_USER_PASSWORD_HASH =
  '$argon2id$v=19$m=65536,t=2,p=1$EcC/76CmMDCWPVGAo4QefcGhFIhNOuvc67xRt0bX78s$huUaLzU4dp/FCeJWH3zVtBUgiFIYQOPEvggZUP1/xjk'

/** Адрес в базе хранится в нижнем регистре — иначе Foo@ и foo@ разойдутся в двух учётках. */
const normalizeEmail = (email: string): string => email.trim().toLowerCase()

/** P2002 — нарушение unique-индекса; здесь он один, по `email`. */
const isUniqueViolation = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002'

/**
 * Один инстанс на всё приложение: и подписывает токены, и проверяет их. Elysia
 * дедуплицирует плагины по имени, так что `.use(jwtPlugin)` в нескольких модулях
 * не создаёт вторую конфигурацию — и секрет не разъедется между выдачей и проверкой.
 */
const jwtPlugin = jwt({ name: 'jwt', secret: env.jwtSecret, exp: env.jwtExpiresIn })

const bearerToken = (header: string | undefined): string | undefined =>
  header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined

/**
 * Guard для маршрутов под авторизацией: `.use(authenticated)` — и в контексте
 * появляется `userId`, а запрос без годного токена до обработчика не доходит.
 *
 * `as: 'scoped'` обязателен: без него `resolve` останется внутри этого плагина и
 * подключивший его модуль не увидит ни `userId`, ни проверки.
 */
export const authenticated = new Elysia({ name: 'authenticated' })
  .use(jwtPlugin)
  .resolve({ as: 'scoped' }, async ({ jwt, headers, status }) => {
    const token = bearerToken(headers.authorization)
    const payload = token ? await jwt.verify(token) : false

    // `verify` отдаёт false на любую негодность разом: чужая подпись, битый
    // формат, истёкший exp. Токен без `sub` формально валиден, но пользователя
    // по нему не найти — для нас это тоже 401.
    if (payload === false || typeof payload.sub !== 'string') {
      return status(401, { message: 'Unauthorized' })
    }

    return { userId: payload.sub }
  })

export const authModule = new Elysia({ prefix: '/auth', tags: ['Auth'] })
  .use(jwtPlugin)
  .post(
    '/register',
    async ({ body, jwt, status }) => {
      const email = normalizeEmail(body.email)

      try {
        const user = await prisma.user.create({
          data: { email, passwordHash: await Bun.password.hash(body.password) },
          select: { id: true, email: true },
        })

        return status(201, { token: await jwt.sign({ sub: user.id, email: user.email }) })
      } catch (error) {
        // Проверять занятость отдельным SELECT'ом бессмысленно: между ним и
        // вставкой всё равно есть окно, а unique-индекс закрывает его сам.
        if (isUniqueViolation(error)) {
          return status(409, { message: 'Email already registered' })
        }

        throw error
      }
    },
    {
      body: credentials,
      response: {
        201: tokenResponse,
        409: messageResponse,
      },
      detail: { summary: 'Register with e-mail and password' },
    },
  )
  .post(
    '/login',
    async ({ body, jwt, status }) => {
      const user = await prisma.user.findUnique({ where: { email: normalizeEmail(body.email) } })

      const passwordMatches = await Bun.password.verify(
        body.password,
        user?.passwordHash ?? ABSENT_USER_PASSWORD_HASH,
      )

      if (!user || !passwordMatches) {
        return status(401, INVALID_CREDENTIALS)
      }

      return { token: await jwt.sign({ sub: user.id, email: user.email }) }
    },
    {
      body: credentials,
      response: {
        200: tokenResponse,
        401: messageResponse,
      },
      detail: { summary: 'Log in with e-mail and password' },
    },
  )
