import type { FormError } from '@nuxt/ui'

import type { AuthFailure, Credentials, PasswordChange, PasswordChangeFailure } from '~/types/auth'
import { apiMessageOf, NO_CONNECTION_MESSAGE, statusOf } from '~/utils/api'

/**
 * Границы повторяют схемы `credentials` и `password` на api; граница пароля там
 * одна у регистрации, входа и обоих полей смены пароля. Дублирование
 * осознанное: без клиентской проверки пользователь узнаёт о коротком пароле
 * только из 422, а разъехавшиеся границы дают форму, которая пропускает заведомо
 * отказной запрос. Меняешь схему в `apps/api/src/modules/auth.ts` — меняй и здесь.
 */
export const EMAIL_MAX_LENGTH = 254
export const PASSWORD_MIN_LENGTH = 8
export const PASSWORD_MAX_LENGTH = 128

/**
 * Проверка формата намеренно грубая: точный разбор адреса — дело api и почтового
 * сервера, а строгая регулярка отбивает валидные экзотические адреса.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Одна проверка пароля на все формы: вход, регистрация и оба поля смены
 * пароля. Отличается только текст про пустое поле — его передаёт форма.
 */
const checkPassword = (password: string, emptyMessage: string): string | null => {
  if (!password) {
    return emptyMessage
  }

  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Минимум ${PASSWORD_MIN_LENGTH} символов`
  }

  if (password.length > PASSWORD_MAX_LENGTH) {
    return `Не длиннее ${PASSWORD_MAX_LENGTH} символов`
  }

  return null
}

/**
 * Валидатор для `:validate` у `UForm`: пустой массив — форма валидна.
 *
 * `emptyPasswordMessage` параметром, потому что правила у входа и регистрации
 * одни, а текст — нет: на регистрации пароль придумывают, на входе вспоминают.
 * Один общий текст на обеих формах читался бы как чужой на одной из них.
 */
export const validateCredentials = (
  state: Partial<Credentials>,
  emptyPasswordMessage: string,
): FormError[] => {
  const errors: FormError[] = []
  const email = state.email?.trim() ?? ''
  const password = state.password ?? ''

  if (!email) {
    errors.push({ name: 'email', message: 'Введите адрес электронной почты' })
  } else if (!EMAIL_PATTERN.test(email)) {
    errors.push({ name: 'email', message: 'Похоже, в адресе опечатка' })
  } else if (email.length > EMAIL_MAX_LENGTH) {
    errors.push({ name: 'email', message: `Адрес длиннее ${EMAIL_MAX_LENGTH} символов` })
  }

  const passwordError = checkPassword(password, emptyPasswordMessage)

  if (passwordError) {
    errors.push({ name: 'password', message: passwordError })
  }

  return errors
}

/** Поля формы смены пароля: тело `POST /auth/me/password` плюс повтор нового. */
export interface PasswordChangeState extends PasswordChange {
  confirmPassword: string
}

/**
 * Валидатор формы смены пароля для `:validate` у `UForm`. Ошибки — в порядке
 * полей на экране: по первой из них форма переносит фокус.
 *
 * Текущий пароль подчиняется тем же 8–128, что и новый: api отбивает его вне
 * границ 422-м, как пароль на входе.
 *
 * Совпадение нового с текущим здесь намеренно не проверяется, хотя оба поля под
 * рукой. Api сверяет его только после текущего пароля: на неверный текущий,
 * совпавший с новым, ответ «совпадает с текущим» был бы неправдой — и клиентская
 * проверка соврала бы ровно так же. Поэтому этот отказ приходит 400-м.
 */
export const validatePasswordChange = (state: Partial<PasswordChangeState>): FormError[] => {
  const errors: FormError[] = []
  const newPassword = state.newPassword ?? ''
  const confirmPassword = state.confirmPassword ?? ''

  const currentError = checkPassword(state.currentPassword ?? '', 'Введите текущий пароль')
  const newError = checkPassword(newPassword, 'Придумайте новый пароль')

  if (currentError) {
    errors.push({ name: 'currentPassword', message: currentError })
  }

  if (newError) {
    errors.push({ name: 'newPassword', message: newError })
  }

  // Повтор сверяется посимвольно, без обрезки: пробел в пароле — тоже символ.
  if (!confirmPassword) {
    errors.push({ name: 'confirmPassword', message: 'Повторите новый пароль' })
  } else if (confirmPassword !== newPassword) {
    errors.push({ name: 'confirmPassword', message: 'Не совпадает с новым паролем' })
  }

  return errors
}

/**
 * Тексты 403 и 400 на случай, если api не прислал своих. Обычно они приходят в
 * `message` тела и показываются как есть — это его русские тексты для
 * пользователя, по образцу 415/413/409 у файлов встречи.
 */
const WRONG_CURRENT_PASSWORD = 'Текущий пароль неверен'
const SAME_PASSWORD = 'Новый пароль совпадает с текущим'

/**
 * Раскладывает отказ `POST /auth/me/password`. 401 сюда не попадает: его ловит
 * `isUnauthorized` раньше — это конец сессии, а не ошибка в поле.
 *
 * 403 и 400 — про конкретные поля, и текст уходит под них: под строку `help`,
 * поэтому он обязан помещаться в одну строку на 360px. Остальное — про запрос
 * целиком, без `field`: такое страница показывает тостом.
 */
export const describePasswordChangeFailure = (error: unknown): PasswordChangeFailure => {
  switch (statusOf(error)) {
    case 403:
      return { field: 'currentPassword', message: apiMessageOf(error) ?? WRONG_CURRENT_PASSWORD }
    case 400:
      return { field: 'newPassword', message: apiMessageOf(error) ?? SAME_PASSWORD }
    case 422:
      // Нашу проверку тело прошло, значит, границы здесь и на api разъехались.
      return {
        message: `API отклонил пароль. Нужно от ${PASSWORD_MIN_LENGTH} до ${PASSWORD_MAX_LENGTH} символов.`,
      }
    case undefined:
      return { message: NO_CONNECTION_MESSAGE }
    default:
      return { message: 'Не удалось сменить пароль. Попробуйте ещё раз.' }
  }
}

/** Тело формы api не устроило, хотя нашу валидацию оно прошло: границы разъехались. */
const REJECTED_BY_API = 'API отклонил данные формы — проверьте адрес и пароль.'

/**
 * Раскладывает отказ `/auth/register` на текст для пользователя. 409 — единственный
 * содержательный случай: api отвечает им на занятый адрес (нарушение unique-индекса).
 */
export const describeRegisterFailure = (error: unknown): AuthFailure => {
  switch (statusOf(error)) {
    case 409:
      return { field: 'email', message: 'Этот адрес уже зарегистрирован' }
    case 422:
      return { message: REJECTED_BY_API }
    case undefined:
      return { message: NO_CONNECTION_MESSAGE }
    default:
      return { message: 'Не удалось создать аккаунт. Попробуйте ещё раз.' }
  }
}

/**
 * Раскладывает отказ `/auth/login`. Ключевое отличие от регистрации — 401 без
 * `field`: api намеренно отвечает одинаково на неизвестный адрес и на неверный
 * пароль, чтобы по ответу не перебирали зарегистрированные адреса. Подсветить
 * одно из полей значило бы додумать за api то, чего он не сказал, — поэтому
 * текст уходит в алерт над формой.
 */
export const describeLoginFailure = (error: unknown): AuthFailure => {
  switch (statusOf(error)) {
    case 401:
      return { message: 'Неверный адрес почты или пароль' }
    case 422:
      return { message: REJECTED_BY_API }
    case undefined:
      return { message: NO_CONNECTION_MESSAGE }
    default:
      return { message: 'Не удалось войти. Попробуйте ещё раз.' }
  }
}
