import { NO_CONNECTION_MESSAGE, statusOf } from '~/utils/api'

/**
 * Сколько прошедших встреч показывает блок «Последние встречи». Это и `limit`
 * запроса `scope=past`: api отдаёт ровно столько, самые свежие первыми.
 */
export const RECENT_MEETINGS_LIMIT = 3

/**
 * Размер страницы предстоящих встреч — и первой, и каждой по «Показать ещё».
 * Api принимает до 100; 20 строк — экран-два, дальше листать списком дольше,
 * чем дождаться следующей страницы.
 */
export const UPCOMING_PAGE_SIZE = 20

/** Сколько адресов участников видно в строке встречи до сворачивания в «+N». */
export const PARTICIPANTS_PREVIEW_LIMIT = 3

/**
 * `Intl.DateTimeFormat` собирается один раз: конструктор заметно дороже самого
 * `format`, а вызывается он на каждую строку списка.
 *
 * Год в формате есть намеренно: без него «12 сентября» у встречи из другого года
 * выглядит как ближайшая. Время браузер покажет в своей зоне — api присылает UTC.
 */
const meetingDateTimeFormat = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

export const formatMeetingDate = (iso: string): string =>
  meetingDateTimeFormat.format(new Date(iso))

interface PluralForms {
  /** 1 встреча */
  one: string
  /** 2 встречи */
  few: string
  /** 5 встреч */
  many: string
}

const pluralRules = new Intl.PluralRules('ru-RU')

/**
 * Число со словом в правильной форме: «1 встреча», «3 встречи», «7 встреч».
 * Категорию (`one`/`few`/`many`) выбирает `Intl.PluralRules`, слова — наши.
 *
 * Нужно не для красоты: счётчик у заголовка и «+N» у участников читает
 * скринридер, а голое число он объявляет без контекста.
 */
export const plural = (count: number, forms: PluralForms): string => {
  const category = pluralRules.select(count)
  const word = category === 'one' ? forms.one : category === 'few' ? forms.few : forms.many

  return `${count} ${word}`
}

export const MEETING_FORMS: PluralForms = { one: 'встреча', few: 'встречи', many: 'встреч' }

export const PARTICIPANT_FORMS: PluralForms = {
  one: 'участник',
  few: 'участника',
  many: 'участников',
}

/**
 * Отказ `GET /meetings` в виде текста. 401 сюда не попадает: его ловит
 * `isUnauthorized` раньше и заканчивает сессию, а не показывает сообщение.
 */
export const describeMeetingsFailure = (error: unknown): string => {
  switch (statusOf(error)) {
    case undefined:
      return NO_CONNECTION_MESSAGE
    default:
      return 'Не удалось загрузить встречи. Попробуйте обновить список.'
  }
}

/**
 * Отказ догрузки по «Показать ещё». Уже показанные встречи остаются на месте,
 * поэтому текст — про следующую страницу, а не про список целиком. 400 на
 * курсор отдельно не разбирается: курсор приходит от api и уходит обратно как
 * есть, так что такой отказ — разъезд версий, а не ошибка пользователя.
 */
export const describeMoreMeetingsFailure = (error: unknown): string => {
  switch (statusOf(error)) {
    case undefined:
      return NO_CONNECTION_MESSAGE
    default:
      return 'Не удалось загрузить ещё встречи. Попробуйте ещё раз.'
  }
}

/**
 * Отказ `GET /meetings/:id` на странице встречи. 404 сюда не попадает: чужая и
 * несуществующая встреча — это отдельное состояние страницы с объяснением и
 * дорогой назад, а не сообщение об ошибке загрузки.
 */
export const describeMeetingFailure = (error: unknown): string => {
  switch (statusOf(error)) {
    case undefined:
      return NO_CONNECTION_MESSAGE
    default:
      return 'Не удалось загрузить встречу. Попробуйте ещё раз.'
  }
}
