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
