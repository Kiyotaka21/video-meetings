/**
 * Контракт `/meetings/:id/files` на api — схема `fileResponse` в
 * `apps/api/src/modules/files.ts`.
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
  mimeType: string
  kind: FileKind
  status: FileStatus
  createdAt: string
}
