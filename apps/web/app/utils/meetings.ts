import type { Meeting } from '~/types/meetings'
import { NO_CONNECTION_MESSAGE, statusOf } from '~/utils/api'

/** Сколько прошедших встреч показывает блок «Последние встречи». */
export const RECENT_MEETINGS_LIMIT = 3

/** Сколько адресов участников видно в строке встречи до сворачивания в «+N». */
export const PARTICIPANTS_PREVIEW_LIMIT = 3

export interface SplitMeetings {
  /** Ещё не состоявшиеся, ближайшая первой. */
  upcoming: Meeting[]
  /** Уже прошедшие, самая свежая первой, не больше `RECENT_MEETINGS_LIMIT`. */
  recent: Meeting[]
}

/**
 * Делит список по «сейчас».
 *
 * Полагается на то, что api отдаёт встречи по возрастанию `date` — это его
 * контракт, зафиксированный в `apps/api/tests/meetings.e2e.test.ts`, поэтому
 * предстоящие остаются в исходном порядке и досортировывать их незачем: вторая
 * сортировка стала бы вторым источником правды о порядке. Прошедшие
 * переворачиваем — «последние» значит недавние, а не самые старые.
 *
 * `now` параметром, а не `Date.now()` внутри: иначе функцию не проверить.
 */
export const splitMeetings = (meetings: Meeting[], now: number = Date.now()): SplitMeetings => {
  const upcoming: Meeting[] = []
  const past: Meeting[] = []

  for (const meeting of meetings) {
    if (Date.parse(meeting.date) >= now) {
      upcoming.push(meeting)
    } else {
      past.push(meeting)
    }
  }

  return { upcoming, recent: past.reverse().slice(0, RECENT_MEETINGS_LIMIT) }
}

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
