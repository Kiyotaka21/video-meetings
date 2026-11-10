import { Elysia } from 'elysia'

/**
 * Потолок тела для всех маршрутов, кроме потоковых загрузок.
 *
 * Потолок у Bun.serve (`MAX_REQUEST_BODY_SIZE`, 64 ГиБ) поднят ради записи до
 * 2 ГБ, но действует на любой маршрут, а тело со схемой Elysia читает в память
 * целиком — до валидации и до guard'а (`resolve` идёт после разбора тела).
 * Без этого рубежа один запрос на `/auth/login` в несколько гигабайт, без
 * токена, раздувал бы процесс до падения по памяти — вместе со всеми
 * загрузками, которые в этот момент идут.
 *
 * Рубеж — `onRequest`, а не свой парсер: глобальный `onParse` ломает маршруты
 * с `parse: 'none'` — Elysia пропускает разбор тела, только когда `none` у
 * маршрута единственный парсер, и загрузка файла получала 400.
 */

/** 64 КиБ: встреча со 100 адресами по 254 символа — около 26 КиБ. */
export const MAX_JSON_BODY_SIZE = 64 * 1024

/**
 * Маршруты, которые сами читают тело потоком со своим лимитом (`parse: 'none'`).
 * Новый такой маршрут обязан попасть сюда — иначе он упрётся в 64 КиБ. Список
 * сверяет тест с маршрутами приложения (`tests/body-limit.e2e.test.ts`).
 */
export const STREAMING_ROUTES: ReadonlyArray<{ method: string; path: RegExp }> = [
  // `src/modules/files/index.ts` — файл встречи до 2 ГБ.
  { method: 'POST', path: /^\/meetings\/[^/]+\/files$/ },
  // `src/modules/auth.ts` — аватар до 2 МБ.
  { method: 'PUT', path: /^\/auth\/me\/avatar$/ },
]

const WITHOUT_BODY: ReadonlySet<string> = new Set(['GET', 'HEAD', 'OPTIONS'])

const isStreaming = (method: string, pathname: string): boolean =>
  STREAMING_ROUTES.some((route) => route.method === method && route.path.test(pathname))

export const bodyLimit = new Elysia({ name: 'body-limit' }).onRequest(({ request, set }) => {
  if (WITHOUT_BODY.has(request.method)) {
    return
  }

  if (isStreaming(request.method, new URL(request.url).pathname)) {
    return
  }

  const declared = request.headers.get('content-length')

  if (declared !== null) {
    if (Number(declared) > MAX_JSON_BODY_SIZE) {
      set.status = 413

      return { message: 'Request body is too large' }
    }

    return
  }

  // Тело без длины (chunked) Elysia тоже прочла бы целиком, а сверить его не с
  // чем до чтения. Браузер у `fetch` со строковым телом длину шлёт всегда.
  if (request.body !== null) {
    set.status = 411

    return { message: 'Content-Length is required' }
  }
})
