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
 * Отказ авторизации в виде, пригодном для формы: с `field` текст уезжает под
 * конкретное поле, без него — в общий алерт над формой.
 */
export interface AuthFailure {
  field?: keyof Credentials
  message: string
}
