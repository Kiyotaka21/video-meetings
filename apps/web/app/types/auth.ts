/**
 * Контракт `/auth/register` и `/auth/login` на api — схема `credentials`
 * в `apps/api/src/modules/auth.ts`. Тело у обоих маршрутов одинаковое.
 */
export interface Credentials {
  email: string
  password: string
}

/**
 * Успешный ответ регистрации, входа и смены пароля: JWT (HS256), в `sub` лежит
 * id пользователя. После смены пароля токены, выпущенные раньше, api не
 * принимает — этот заменяет их в куке.
 */
export interface TokenResponse {
  token: string
}

/**
 * Тело `POST /auth/me/password` — схема `passwordChange` на api. Оба поля в тех
 * же границах, что пароль в `Credentials`. Отказы: 403 — неверный текущий, 400 —
 * новый совпадает с текущим, оба с текстом для показа как есть; не 401, который
 * значит конец сессии.
 */
export interface PasswordChange {
  currentPassword: string
  newPassword: string
}

/**
 * Ответ `GET /auth/me`. Читается из базы по `sub` из токена, а не из самого
 * токена: payload JWT контрактом не зафиксирован, а этот маршрут — зафиксирован
 * тестом `tests/auth.e2e.test.ts`.
 */
export interface AuthUser {
  id: string
  email: string
  /** Уже обрезанное по краям; `null` — имя не задано, вместо него показывают адрес. */
  name: string | null
}

/**
 * Отказ авторизации в виде, пригодном для формы: с `field` текст уезжает под
 * конкретное поле, без него — в общий алерт над формой.
 */
export interface AuthFailure {
  field?: keyof Credentials
  message: string
}
