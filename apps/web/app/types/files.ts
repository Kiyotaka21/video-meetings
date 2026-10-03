/**
 * Контракт `/meetings/:id/files` на api — схема `fileResponse` в
 * `apps/api/src/modules/files/index.ts`.
 *
 * `createdAt` — строка ISO-8601 в UTC с миллисекундами, как и даты у `/meetings`.
 * Пути на диске здесь нет намеренно: он внутреннее дело api.
 */

/** Группа формата: от неё зависят иконка, подпись и (с фазы 6) плеер. */
export type FileKind = 'recording' | 'document'

/**
 * Место под будущую обработку записи. Сейчас api всегда отдаёт `uploaded` —
 * остальные значения заведены в схеме, чтобы транскрибация не потребовала
 * переделывать интерфейс.
 */
export type FileStatus = 'uploaded' | 'processing' | 'ready' | 'failed'

export interface MeetingFile {
  id: string
  /** Имя, под которым файл выбрал пользователь, — в путь на диске оно не попадает. */
  name: string
  /** Байты числом: api конвертирует `BigInt` на границе ответа. */
  size: number
  /** Канонический тип формата, а не заявленный при загрузке: его выбирает api. */
  mimeType: string
  kind: FileKind
  status: FileStatus
  createdAt: string
  /**
   * Путь отдачи от корня api с файловым токеном в `?token=` — для `<video src>`
   * и ссылки на скачивание, которые не умеют слать `Authorization`. Склеивается
   * с `apiUrl` так же, как `$fetch` склеивает `baseURL`. Токен живёт 15 минут:
   * протухшую ссылку лечит перезапрос списка.
   */
  url: string
}
