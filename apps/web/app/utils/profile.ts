import { NO_CONNECTION_MESSAGE, statusOf } from '~/utils/api'

/**
 * Отказ `GET /auth/me` на странице профиля. 401 сюда не попадает: его ловит
 * `isUnauthorized` раньше и заканчивает сессию, а не показывает сообщение.
 */
export const describeProfileFailure = (error: unknown): string => {
  switch (statusOf(error)) {
    case undefined:
      return NO_CONNECTION_MESSAGE
    default:
      return 'Не удалось загрузить профиль. Попробуйте ещё раз.'
  }
}
