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
 * `message` из тела отказа — у ofetch тело ответа лежит в `data`. Нужен там,
 * где api формулирует причину для пользователя сам (лимиты загрузки файла);
 * служебные английские сообщения остальных отказов показывать не надо.
 */
export const apiMessageOf = (error: unknown): string | undefined => {
  if (typeof error !== 'object' || error === null || !('data' in error)) {
    return undefined
  }

  const { data } = error

  return typeof data === 'object' &&
    data !== null &&
    'message' in data &&
    typeof data.message === 'string'
    ? data.message
    : undefined
}

/**
 * Api не принял токен: истёк, выпущен против другой базы или учётку удалили.
 * Все три случая приезжают одним 401 — намеренно, см. `authenticated` и
 * `GET /auth/me` в `apps/api/src/modules/auth.ts`. Поэтому и обработка одна:
 * сессии больше нет, надо выйти и увести на `/login`.
 */
export const isUnauthorized = (error: unknown): boolean => statusOf(error) === 401

/**
 * Полный адрес на api по пути от его корня — для мест, где `$fetch` с `baseURL`
 * не участвует: `<video src>`, ссылка на скачивание, `XMLHttpRequest`. Поле `url`
 * у файла приходит именно путём (api не знает, под каким origin'ом его видит
 * браузер), и вставленное как есть оно ушло бы на origin фронтенда.
 *
 * Склейка строкой, а не `new URL(path, apiUrl)`: путь с ведущим слэшем
 * отбросил бы префикс у адреса вида `https://host/api`.
 */
export const apiHref = (apiUrl: string, path: string): string =>
  `${apiUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`

/** Один текст на все запросы: причина у пользователя одна и та же. */
export const NO_CONNECTION_MESSAGE = 'Нет связи с API. Проверьте, что бэкенд запущен.'
