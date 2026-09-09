/**
 * Разбор отказов api на уровне HTTP. Тексты для пользователя живут рядом со
 * своим доменом (`utils/auth.ts`, `utils/meetings.ts`) — здесь только то, что
 * общее для всех запросов.
 */

/**
 * У ofetch код ответа лежит в `statusCode`. Проверяем структурно, а не через
 * `instanceof FetchError`: тип пришлось бы тянуть из транзитивной зависимости.
 *
 * `undefined` означает, что ответа не было вовсе: api не запущен, упал CORS
 * или пропала сеть.
 */
export const statusOf = (error: unknown): number | undefined =>
  typeof error === 'object' &&
  error !== null &&
  'statusCode' in error &&
  typeof error.statusCode === 'number'
    ? error.statusCode
    : undefined

/**
 * Api не принял токен: истёк, выпущен против другой базы или учётку удалили.
 * Все три случая приезжают одним 401 — намеренно, см. `authenticated` и
 * `GET /auth/me` в `apps/api/src/modules/auth.ts`. Поэтому и обработка одна:
 * сессии больше нет, надо выйти и увести на `/login`.
 */
export const isUnauthorized = (error: unknown): boolean => statusOf(error) === 401

/** Один текст на все запросы: причина у пользователя одна и та же. */
export const NO_CONNECTION_MESSAGE = 'Нет связи с API. Проверьте, что бэкенд запущен.'
