/**
 * Контракт `/auth/register` и `/auth/login` на api — схема `credentials`
 * в `apps/api/src/modules/auth.ts`. Тело у обоих маршрутов одинаковое.
 */
export interface Credentials {
  email: string
  password: string
}

/** Успешный ответ обоих маршрутов: JWT (HS256), в `sub` лежит id пользователя. */
export interface TokenResponse {
  token: string
}

/**
 * Ответ `GET /auth/me`. Читается из базы по `sub` из токена, а не из самого
 * токена: payload JWT контрактом не зафиксирован, а этот маршрут — зафиксирован
 * тестом `tests/auth.e2e.test.ts`.
 */
export interface AuthUser {
  id: string
  email: string
}

/**
 * Отказ авторизации в виде, пригодном для формы: с `field` текст уезжает под
 * конкретное поле, без него — в общий алерт над формой.
 */
export interface AuthFailure {
  field?: keyof Credentials
  message: string
}
