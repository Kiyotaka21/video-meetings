import { Elysia } from 'elysia'

/**
 * Необработанное исключение наружу уходит общим 500, без текста ошибки.
 *
 * Обработчик Elysia по умолчанию отдаёт `error.message` как есть, а у ошибок
 * Prisma в нём путь к исходнику и кусок запроса. Отказы, которые api отдаёт
 * сам (`status(...)`), валидация (422) и разбор тела (400) сюда не попадают —
 * у них свои коды, и их тела остаются прежними.
 */
export const INTERNAL_ERROR = { message: 'Internal Server Error' } as const

/**
 * Коды Elysia, за которыми стоит ошибка клиента со своим ответом. Остальное
 * маскируется — список «чужих» не годится: `code` у Elysia берётся из поля
 * `code` самой ошибки, и у Prisma там `P2010` и прочие, а не `UNKNOWN`.
 */
const CLIENT_ERRORS: ReadonlySet<unknown> = new Set([
  'VALIDATION',
  'PARSE',
  'NOT_FOUND',
  'INVALID_COOKIE_SIGNATURE',
  'INVALID_FILE_TYPE',
])

export const internalErrors = new Elysia({ name: 'internal-errors' }).onError(
  { as: 'global' },
  ({ code, error, set }) => {
    // Число — брошенный `status(...)`: ответ api, а не сбой.
    if (typeof code === 'number' || CLIENT_ERRORS.has(code)) {
      return
    }

    // Текст ошибки нужен разработчику, а не клиенту: он уходит в лог процесса.
    console.error(error)

    // Готовый `Response`, а не объект: заголовки из `set` (CORS) Elysia
    // добавит к нему сама.
    set.status = 500

    return Response.json(INTERNAL_ERROR, { status: 500 })
  },
)
