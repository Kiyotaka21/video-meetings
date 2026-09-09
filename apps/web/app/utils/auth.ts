import type { FormError } from '@nuxt/ui'

import type { AuthFailure, Credentials } from '~/types/auth'

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

/** Валидатор для `:validate` у `UForm`: пустой массив — форма валидна. */
export const validateCredentials = (state: Partial<Credentials>): FormError[] => {
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
    errors.push({ name: 'password', message: 'Придумайте пароль' })
  } else if (password.length < PASSWORD_MIN_LENGTH) {
    errors.push({ name: 'password', message: `Минимум ${PASSWORD_MIN_LENGTH} символов` })
  } else if (password.length > PASSWORD_MAX_LENGTH) {
    errors.push({ name: 'password', message: `Не длиннее ${PASSWORD_MAX_LENGTH} символов` })
  }

  return errors
}

/**
 * У ofetch код ответа лежит в `statusCode`. Проверяем структурно, а не через
 * `instanceof FetchError`: тип пришлось бы тянуть из транзитивной зависимости.
 */
const statusOf = (error: unknown): number | undefined =>
  typeof error === 'object' &&
  error !== null &&
  'statusCode' in error &&
  typeof error.statusCode === 'number'
    ? error.statusCode
    : undefined

/**
 * Раскладывает отказ `/auth/register` на текст для пользователя. 409 — единственный
 * содержательный случай: api отвечает им на занятый адрес (нарушение unique-индекса).
 */
export const describeRegisterFailure = (error: unknown): AuthFailure => {
  switch (statusOf(error)) {
    case 409:
      return { field: 'email', message: 'Этот адрес уже зарегистрирован' }
    case 422:
      return { message: 'API отклонил данные формы — проверьте адрес и пароль.' }
    case undefined:
      // Ни статуса, ни ответа: api не запущен, упал CORS или пропала сеть.
      return { message: 'Нет связи с API. Проверьте, что бэкенд запущен.' }
    default:
      return { message: 'Не удалось создать аккаунт. Попробуйте ещё раз.' }
  }
}
