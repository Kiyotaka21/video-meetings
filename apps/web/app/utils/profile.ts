import type { FormError } from '@nuxt/ui'

import { apiMessageOf, NO_CONNECTION_MESSAGE, statusOf } from '~/utils/api'
import { extensionOf } from '~/utils/files'

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
 * Тексты — в одну строку на 360px (281px под полем, замер: с блоком «Пароль»
 * страница прокручивается, и обычная полоса прокрутки Chrome съедает 15px), как
 * и тексты `validateName`: текст встаёт на место подсказки, и вторая строка
 * сдвинула бы кнопку. Поэтому и «нет связи» здесь свой, короче общего
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

/*
 * Ограничения аватара — копия `apps/api/src/modules/avatars/formats.ts`, ровно
 * как лимиты файлов встречи в `utils/files.ts`. Разъезд не поймают ни типы, ни
 * сборка: форма начнёт гнать на api заведомо отказные файлы или отбивать
 * годные. Меняешь лимит или тексты на api — меняй здесь, и наоборот. Тексты
 * отказов те же, что отдаёт api, — пользователь видит одну и ту же фразу, кто
 * бы ни отказал.
 *
 * Формат здесь судится по расширению, а api — по первым байтам файла. Клиенту
 * хватает отсечь очевидное без запроса: `.gif`, `.svg` и `.heic` до api не
 * доедут, а `.png` с чужим содержимым отобьёт api своим 415 — тем же текстом.
 * Заявленный тип не смотрим: HEIC браузер на Windows часто отдаёт с пустым
 * `type`, а api его не читает вовсе.
 */

/** 2 МиБ — столько файловый менеджер и api показывают как «2 МБ». */
export const MAX_AVATAR_SIZE = 2 * 1024 ** 2

/** Расширения трёх форматов api: JPEG (`.jpg` и `.jpeg`), PNG и WebP. */
const AVATAR_EXTENSIONS: readonly string[] = ['.jpg', '.jpeg', '.png', '.webp']

const AVATAR_TOO_LARGE = 'Изображение больше 2 МБ'

const AVATAR_UNSUPPORTED = 'Подходят только изображения JPEG, PNG и WebP'

/**
 * `accept` для диалога выбора — подсказка диалогу, а не проверка: «Все файлы»
 * в нём выбрать можно, и такой файл отобьёт `checkAvatarBeforeUpload`. Только
 * расширения, без MIME-типов: по `image/jpeg` Chrome на Windows показал бы и
 * `.jfif`, который проверка ниже не пропустит.
 */
export const AVATAR_ACCEPT = AVATAR_EXTENSIONS.join(',')

/**
 * Проверка до отправки: формат по расширению и размер. `null` — файл годен.
 * Отказ здесь означает, что на api не ушло ни одного запроса.
 *
 * Формат — раньше размера, хотя api отвечает 413 раньше 415 (размер он знает
 * из `Content-Length` до чтения тела): `.gif` на 3 МБ не станет годным, если
 * его ужать, и «больше 2 МБ» отправило бы пользователя ужимать то, что всё
 * равно не примут. До api такой файл не доезжает, так что разные ответы на
 * один файл не встретятся.
 */
export const checkAvatarBeforeUpload = (image: File): string | null => {
  if (!AVATAR_EXTENSIONS.includes(extensionOf(image.name))) {
    return AVATAR_UNSUPPORTED
  }

  if (image.size > MAX_AVATAR_SIZE) {
    return AVATAR_TOO_LARGE
  }

  return null
}

/**
 * Отказ `PUT /auth/me/avatar`. 401 сюда не попадает: его ловит
 * `isUnauthorized` раньше и заканчивает сессию.
 *
 * Формат (415), размер (413) и тело, пришедшее не целиком (400), api объясняет
 * сам — по-русски и для показа как есть, как у файлов встречи. Обычно такой
 * файл до api не доезжает, но рубеж там: `.png` с чужим содержимым или
 * разъехавшаяся копия лимита приедут отсюда, и «попробуйте ещё раз» на них
 * было бы враньём.
 */
export const describeAvatarUploadFailure = (error: unknown): string => {
  switch (statusOf(error)) {
    case undefined:
      return NO_CONNECTION_MESSAGE
    case 400:
    case 413:
    case 415:
      return apiMessageOf(error) ?? 'Аватар не загрузился. Попробуйте ещё раз.'
    default:
      return 'Аватар не загрузился. Попробуйте ещё раз.'
  }
}

/** Отказ `DELETE /auth/me/avatar`. 401 сюда не попадает, как и у загрузки. */
export const describeAvatarDeleteFailure = (error: unknown): string =>
  statusOf(error) === undefined ? NO_CONNECTION_MESSAGE : 'Аватар не удалился. Попробуйте ещё раз.'

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
