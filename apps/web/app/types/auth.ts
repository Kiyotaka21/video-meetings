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
 * Ответ `GET /auth/me` — и `PATCH /auth/me`, `PUT` и `DELETE /auth/me/avatar`.
 * Читается из базы по `sub` из токена, а не из самого токена: тот — снимок на
 * момент выпуска, без имени и аватара. Форма ответа зафиксирована тестами
 * `tests/auth.e2e.test.ts` и `tests/avatar.e2e.test.ts`.
 */
export interface AuthUser {
  id: string
  email: string
  /** Уже обрезанное по краям; `null` — имя не задано, вместо него показывают адрес. */
  name: string | null
  /**
   * Путь `/avatars/<ключ>.<ext>` от корня api, а не адрес: склеивается с `apiUrl`
   * так же, как `url` у файла встречи. Токен не нужен — ключ случайный и новый
   * при каждой загрузке. `null` — аватара нет, вместо него иконка-заглушка.
   */
  avatarUrl: string | null
}

/**
 * Действие с аватаром, которое сейчас в полёте: `PUT` или `DELETE
 * /auth/me/avatar`. Одно на блок — пока идёт одно, второе не начинается.
 */
export type AvatarAction = 'upload' | 'delete'

/**
 * Отказ авторизации в виде, пригодном для формы: с `field` текст уезжает под
 * конкретное поле, без него — в общий алерт над формой.
 */
export interface AuthFailure {
  field?: keyof Credentials
  message: string
}

/**
 * Отказ смены пароля: с `field` текст уезжает под своё поле (403 — текущий
 * пароль, 400 — новый), без него — про запрос целиком, его страница показывает
 * тостом.
 */
export interface PasswordChangeFailure {
  field?: keyof PasswordChange
  message: string
}
