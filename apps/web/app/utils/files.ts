import type { FileKind, FileStatus, MeetingFile } from '~/types/files'
import { apiMessageOf, NO_CONNECTION_MESSAGE, statusOf } from '~/utils/api'
import { formatMeetingDate } from '~/utils/meetings'

/*
 * Ограничения загрузки — копия контракта api из
 * `apps/api/src/modules/files/limits.ts`, ровно как границы `credentials` в
 * `utils/auth.ts`. Разъезд не поймают ни типы, ни сборка: форма начнёт гнать на
 * api заведомо отказные файлы (2 ГБ ради 413) или отбивать годные. Меняешь
 * список или лимит на api — меняй здесь, и наоборот. Тексты отказов те же, что
 * отдаёт api, — пользователь видит одну и ту же фразу, кто бы ни отказал.
 */

/** 2 ГиБ — столько файловый менеджер показывает как «2 ГБ». */
export const MAX_RECORDING_SIZE = 2 * 1024 ** 3

export const MAX_DOCUMENT_SIZE = 50 * 1024 ** 2

export const MAX_FILES_PER_MEETING = 20

const RECORDING_EXTENSIONS = ['.mp4', '.webm', '.mov', '.mp3', '.m4a', '.wav', '.ogg'] as const

const DOCUMENT_EXTENSIONS = ['.pdf', '.docx', '.pptx', '.xlsx', '.txt', '.md', '.csv'] as const

const KIND_BY_EXTENSION: ReadonlyMap<string, FileKind> = new Map([
  ...RECORDING_EXTENSIONS.map((extension) => [extension, 'recording'] as const),
  ...DOCUMENT_EXTENSIONS.map((extension) => [extension, 'document'] as const),
])

const SIZE_LIMITS: Readonly<Record<FileKind, { maxSize: number; tooLarge: string }>> = {
  recording: { maxSize: MAX_RECORDING_SIZE, tooLarge: 'Файл больше 2 ГБ' },
  document: { maxSize: MAX_DOCUMENT_SIZE, tooLarge: 'Документ больше 50 МБ' },
}

const TOO_MANY_FILES = `Достигнут лимит: во встрече уже ${MAX_FILES_PER_MEETING} файлов, больше загрузить нельзя`

/**
 * `accept` для диалога выбора — только расширения, без MIME-типов. Это
 * подсказка диалогу, а не проверка: с MIME-типами `UFileUpload` фильтровал бы
 * ещё и перетаскивание (`useDropZone` с `dataTypes`), и брошенный `.zip` молча
 * пропадал бы, вместо того чтобы получить внятный отказ.
 */
export const FILE_ACCEPT = [...RECORDING_EXTENSIONS, ...DOCUMENT_EXTENSIONS].join(',')

/** Строки для подсказки под зоной загрузки: без точек, через запятую. */
export const RECORDING_FORMATS_HINT = RECORDING_EXTENSIONS.map((ext) => ext.slice(1)).join(', ')

export const DOCUMENT_FORMATS_HINT = DOCUMENT_EXTENSIONS.map((ext) => ext.slice(1)).join(', ')

/**
 * Расширение тем же правилом, что `extname` на api: ведущая точка — не
 * расширение (`.bashrc`), каталоги в имени не считаются.
 */
const extensionOf = (name: string): string => {
  const base = name.split(/[\\/]/).pop() ?? ''
  const dot = base.lastIndexOf('.')

  return dot > 0 ? base.slice(dot).toLowerCase() : ''
}

/** Расширение, которое не стыдно повторить в тексте отказа, — как на api. */
const PRINTABLE_EXTENSION = /^\.[a-z0-9]{1,16}$/

const unsupportedFormat = (extension: string): string => {
  if (extension === '') {
    return 'Файлы без расширения не поддерживаются'
  }

  return PRINTABLE_EXTENSION.test(extension)
    ? `Формат ${extension} не поддерживается`
    : 'Формат файла не поддерживается'
}

/**
 * Проверка до отправки: формат, размер группы и место во встрече. `null` —
 * файл годен. Отказ здесь означает, что на api не ушло ни одного запроса, —
 * PRD прямо требует не гнать 2 ГБ ради отказа.
 *
 * Заявленный тип не проверяется: браузер берёт его из реестра ОС и для `.m4a`
 * или `.webm` часто оставляет пустым. Подмену типа отобьёт api (415), это его
 * рубеж, а не наш.
 */
export const checkFileBeforeUpload = (file: File, filesInMeeting: number): string | null => {
  const extension = extensionOf(file.name)
  const kind = KIND_BY_EXTENSION.get(extension)

  if (!kind) {
    return unsupportedFormat(extension)
  }

  const { maxSize, tooLarge } = SIZE_LIMITS[kind]

  if (file.size > maxSize) {
    return tooLarge
  }

  if (filesInMeeting >= MAX_FILES_PER_MEETING) {
    return TOO_MANY_FILES
  }

  return null
}

/** Запись — это видео или аудио: плеер, иконка и подпись решаются по типу формата. */
export type FileMedia = 'video' | 'audio' | 'document'

/**
 * `mimeType` в ответе — канонический тип формата, его выбирает api по
 * расширению, а не клиент. Поэтому префикс надёжен: `.webm` всегда `video/webm`,
 * `.m4a` всегда `audio/mp4`.
 */
export const mediaOf = (file: MeetingFile): FileMedia => {
  if (file.kind === 'document') {
    return 'document'
  }

  return file.mimeType.startsWith('audio/') ? 'audio' : 'video'
}

export const FILE_MEDIA_ICONS: Record<FileMedia, string> = {
  video: 'i-lucide-video',
  audio: 'i-lucide-music',
  document: 'i-lucide-file-text',
}

export const FILE_MEDIA_LABELS: Record<FileMedia, string> = {
  video: 'Видеозапись',
  audio: 'Аудиозапись',
  document: 'Документ',
}

/**
 * Статус показывается только у записей: к документам обработка не относится, и
 * «обработка не запускалась» у PDF читалось бы как недоделка.
 */
export const FILE_STATUS_LABELS: Record<FileStatus, string> = {
  uploaded: 'Загружена, обработка не запускалась',
  processing: 'Обрабатывается',
  ready: 'Обработана',
  failed: 'Обработка не удалась',
}

const SIZE_UNITS = ['Б', 'КБ', 'МБ', 'ГБ'] as const

/** Один знак после запятой: «1,4 ГБ» читается, «1,43242 ГБ» — нет. */
const sizeFormat = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 })

/**
 * Размер по основанию 1024, как его считает и показывает файловый менеджер.
 * Строго «МиБ» было бы точнее, но в интерфейсе так никто не пишет.
 */
export const formatFileSize = (bytes: number): string => {
  let size = Math.max(bytes, 0)
  let unit = 0

  while (size >= 1024 && unit < SIZE_UNITS.length - 1) {
    size /= 1024
    unit += 1
  }

  return `${sizeFormat.format(size)} ${SIZE_UNITS[unit] ?? SIZE_UNITS[0]}`
}

/**
 * Дата загрузки показывается тем же форматом, что и дата встречи: два разных
 * формата на одной странице читаются как две разные сущности.
 */
export const formatUploadedAt = (iso: string): string => formatMeetingDate(iso)

/**
 * Отказ `GET /meetings/:id/files`. 401 сюда не попадает — его ловит
 * `isUnauthorized` раньше и заканчивает сессию; 404 страница показывает как
 * «встреча не найдена», а не как сбой блока с файлами.
 */
export const describeFilesFailure = (error: unknown): string => {
  switch (statusOf(error)) {
    case undefined:
      return NO_CONNECTION_MESSAGE
    default:
      return 'Не удалось загрузить файлы встречи. Попробуйте ещё раз.'
  }
}

/**
 * Отказ `POST /meetings/:id/files`. Формат (415), размер (413) и лимит файлов
 * встречи (409) api объясняет сам, по-русски и для показа как есть. До api такой
 * файл обычно не доезжает — его отбивает `checkFileBeforeUpload`, — но рубеж там:
 * разъехавшаяся копия лимитов или подмена типа (415) приедут отсюда.
 * «Попробуйте ещё раз» на них было бы враньём: повтор упрётся в тот же отказ.
 */
export const describeUploadFailure = (error: unknown): string => {
  switch (statusOf(error)) {
    case undefined:
      return NO_CONNECTION_MESSAGE
    case 404:
      return 'Встреча не найдена — возможно, её удалили.'
    case 409:
    case 413:
    case 415:
      return apiMessageOf(error) ?? 'Этот файл загрузить нельзя.'
    default:
      return 'Файл не загрузился. Попробуйте ещё раз.'
  }
}

/**
 * Отказ `DELETE /meetings/:id/files/:fileId`. 404 сюда не попадает: файла уже
 * нет, и для пользователя это тот же успех — страница просто убирает строку.
 */
export const describeDeleteFailure = (error: unknown): string =>
  statusOf(error) === undefined ? NO_CONNECTION_MESSAGE : 'Файл не удалился. Попробуйте ещё раз.'
