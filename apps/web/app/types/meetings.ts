/**
 * Контракт `/meetings` на api — схема `meetingResponse` в
 * `apps/api/src/modules/meetings.ts`.
 *
 * `date` и `createdAt` — строки ISO-8601 в UTC с миллисекундами: api приводит
 * их к `toISOString()` на выходе, каким бы смещением их ни прислали.
 */
export interface Meeting {
  id: string
  title: string
  date: string
  /** Адреса приглашённых, а не ссылки на пользователей: приглашать можно кого угодно. */
  participants: string[]
  createdAt: string
}

/**
 * Выборка `GET /meetings`. Делит встречи api по своим часам, а не браузер:
 * `upcoming` — `date` не раньше «сейчас», ближайшая первой; `past` — раньше,
 * самая свежая первой.
 */
export type MeetingScope = 'upcoming' | 'past'

/** Страница `GET /meetings` — схема ответа в `apps/api/src/modules/meetings.ts`. */
export interface MeetingsPage {
  items: Meeting[]
  /** Сколько встреч во всей выборке, а не на этой странице: для счётчика у заголовка. */
  total: number
  /** Передаётся в следующий запрос как есть; `null` — страниц дальше нет. */
  nextCursor: string | null
}
