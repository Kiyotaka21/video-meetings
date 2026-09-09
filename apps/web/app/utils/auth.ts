import type { FormError } from '@nuxt/ui'

import type { AuthFailure, Credentials } from '~/types/auth'
import { NO_CONNECTION_MESSAGE, statusOf } from '~/utils/api'

/**
 * Границы повторяют схему `credentials` на api. Дублирование осознанное: без
 * клиентской проверки пользователь узнаёт о коротком пароле только из 422, а
 * разъехавшиеся границы дают форму, которая пропускает заведомо отказной запрос.
 * Меняешь схему в `apps/api/src/modules/auth.ts` — меняй и здесь.
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

  if (!password) {
    errors.push({ name: 'password', message: emptyPasswordMessage })
  } else if (password.length < PASSWORD_MIN_LENGTH) {
    errors.push({ name: 'password', message: `Минимум ${PASSWORD_MIN_LENGTH} символов` })
  } else if (password.length > PASSWORD_MAX_LENGTH) {
    errors.push({ name: 'password', message: `Не длиннее ${PASSWORD_MAX_LENGTH} символов` })
  }

  return errors
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
