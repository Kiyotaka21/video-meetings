import type { FileKind } from '../../../generated/prisma/enums'

/**
 * Все ограничения загрузки — в одном месте: отсюда их читают и обработчик, и
 * тесты. Тест, который держит «.zip» или «20» у себя, молча разойдётся с кодом
 * при первой же правке списка.
 *
 * Проверка до отправки во фронтенде (фаза 5 плана) получит копию этих списков,
 * и с того момента правка здесь тянет правку там: разъезд не поймают ни типы,
 * ни сборка.
 */

export interface FileFormat {
  kind: FileKind
  /**
   * Канонический тип формата. В метаданные уходит он, а не заявленный клиентом:
   * иначе `.pdf`, загруженный с `Content-Type: text/html`, при отдаче уехал бы
   * HTML'ем с origin'а api — хранимая XSS.
   */
  mimeType: string
  /**
   * Заявленные типы, с которыми файл принимается, помимо пустого и
   * `application/octet-stream`. Шире канонического намеренно: браузер берёт тип
   * из реестра ОС, и одно расширение приезжает под разными именами.
   */
  accepts: readonly string[]
}

const recording = (mimeType: string, ...aliases: string[]): FileFormat => ({
  kind: 'recording',
  mimeType,
  accepts: [mimeType, ...aliases],
})

const document = (mimeType: string, ...aliases: string[]): FileFormat => ({
  kind: 'document',
  mimeType,
  accepts: [mimeType, ...aliases],
})

/**
 * Список форматов из PRD. Решает расширение, тип только подтверждает: ключ —
 * расширение в нижнем регистре с точкой, как его отдаёт `extname`. В путь на
 * диске уходит ключ этой таблицы, а не хвост пользовательского имени.
 *
 * `Map`, а не объект: у объекта поиск по ключу из запроса задевает прототип.
 */
export const FORMATS: ReadonlyMap<string, FileFormat> = new Map([
  ['.mp4', recording('video/mp4')],
  ['.webm', recording('video/webm', 'audio/webm')],
  ['.mov', recording('video/quicktime')],
  // Chrome на части систем называет mp3 `audio/mp3` — нестандартно, но честно.
  ['.mp3', recording('audio/mpeg', 'audio/mp3')],
  ['.m4a', recording('audio/mp4', 'audio/x-m4a', 'audio/m4a')],
  ['.wav', recording('audio/wav', 'audio/x-wav', 'audio/wave', 'audio/vnd.wave')],
  ['.ogg', recording('audio/ogg', 'video/ogg', 'application/ogg')],

  ['.pdf', document('application/pdf')],
  ['.docx', document('application/vnd.openxmlformats-officedocument.wordprocessingml.document')],
  ['.pptx', document('application/vnd.openxmlformats-officedocument.presentationml.presentation')],
  ['.xlsx', document('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')],
  ['.txt', document('text/plain')],
  ['.md', document('text/markdown', 'text/x-markdown', 'text/plain')],
  // Установленный Excel перехватывает `.csv` в реестре Windows, и браузер шлёт
  // его тип: без `vnd.ms-excel` честный CSV из Windows отбивался бы 415.
  ['.csv', document('text/csv', 'application/vnd.ms-excel', 'application/csv', 'text/plain')],
])

/**
 * Тип, который ничего не говорит о файле: браузер не нашёл расширение в
 * реестре ОС. Такой файл судится только по расширению.
 */
const UNKNOWN_TYPES: ReadonlySet<string> = new Set(['', 'application/octet-stream'])

/** Заявленный тип допустим для формата: пустой, octet-stream или из его списка. */
export const acceptsDeclaredType = (format: FileFormat, declared: string): boolean =>
  UNKNOWN_TYPES.has(declared) || format.accepts.includes(declared)
