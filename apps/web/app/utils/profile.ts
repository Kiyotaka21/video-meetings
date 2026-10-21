import type { FormError } from '@nuxt/ui'

import { NO_CONNECTION_MESSAGE, statusOf } from '~/utils/api'

/*
 * Правила имени — копия схемы `nameUpdate` (`NAME_PATTERN`) из
 * `apps/api/src/modules/auth.ts`, ровно как границы `credentials` в
 * `utils/auth.ts`. Разъезд не поймают ни типы, ни сборка: форма начнёт
 * отправлять то, что api отвергнет 422-м, либо отбивать годное. Меняешь шаблон
 * или границу на api — меняй здесь, и наоборот.
 *
 * Правила api: пробелы по краям срезаются, пустое после обрезки — сброс имени;
 * длина — до 50 после обрезки, в UTF-16 code units (`String.length`, эмодзи —
 * за два); управляющие символы — отказ где угодно, даже по краям, хотя `trim()`
 * срезал бы перевод строки молча.
 */

/** Граница — после обрезки пробелов по краям, а не по сырой строке. */
export const NAME_MAX_LENGTH = 50

/**
 * Управляющие (Cc: `U+0000–U+001F`, `U+007F–U+009F`) плюс разделители строк и
 * абзацев `U+2028`, `U+2029` — тот же набор, что `CONTROL` на api. Проверка
 * кодами, а не регуляркой: литерал с `\u0000` в классе символов запрещает
 * правило `no-control-regex`.
 */
const isControlCode = (code: number): boolean =>
  code <= 0x1f || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029

const hasControlCharacter = (value: string): boolean => {
  for (let index = 0; index < value.length; index += 1) {
    if (isControlCode(value.charCodeAt(index))) {
      return true
    }
  }

  return false
}

export interface NameState {
  name: string
}

/**
 * Валидатор для `:validate` у `UForm`: пустой массив — форма валидна. Пустое
 * поле годно: это сброс имени, а не ошибка.
 *
 * Управляющие проверяются до обрезки: отсеяв их, `trim()` срезает ровно то же,
 * что шаблон api считает пробелами по краям (Zs и BOM), и длина после него
 * совпадает с той, что считает api.
 */
export const validateName = (state: Partial<NameState>): FormError[] => {
  const raw = state.name ?? ''

  if (hasControlCharacter(raw)) {
    return [{ name: 'name', message: 'Без табуляции и служебных символов' }]
  }

  const { length } = raw.trim()

  if (length > NAME_MAX_LENGTH) {
    return [{ name: 'name', message: `Не длиннее ${NAME_MAX_LENGTH} символов — сейчас ${length}` }]
  }

  return []
}

/**
 * Отказ `PATCH /auth/me` в виде текста под полем. 401 сюда не попадает: его
 * ловит `isUnauthorized` раньше и заканчивает сессию. 422 после нашей проверки
 * означает, что правила разъехались с api.
 *
 * Тексты — в одну строку на 360px (296px под полем, замер), как и тексты
 * `validateName`: текст встаёт на место подсказки, и вторая строка сдвинула бы
 * кнопку. Поэтому и «нет связи» здесь свой, короче общего
 * `NO_CONNECTION_MESSAGE` (312px) — тот живёт в алертах и тостах, где места
 * хватает.
 */
export const describeNameFailure = (error: unknown): string => {
  switch (statusOf(error)) {
    case 422:
      return 'Имя не прошло проверку на сервере'
    case undefined:
      return 'Нет связи с API. Попробуйте позже.'
    default:
      return 'Не сохранилось. Попробуйте ещё раз.'
  }
}

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
