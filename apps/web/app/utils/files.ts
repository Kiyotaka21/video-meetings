import type { FileKind } from '~/types/files'
import { NO_CONNECTION_MESSAGE, statusOf } from '~/utils/api'
import { formatMeetingDate } from '~/utils/meetings'

/**
 * Иконка и подпись по группе. Аудиозаписи получат свою иконку вместе с плеером
 * (фаза 6): сейчас api не отличает видео от аудио в самой группе, и рисовать
 * по `mimeType` пришлось бы второе правило рядом с первым.
 */
export const FILE_KIND_ICONS: Record<FileKind, string> = {
  recording: 'i-lucide-video',
  document: 'i-lucide-file-text',
}

export const FILE_KIND_LABELS: Record<FileKind, string> = {
  recording: 'Запись',
  document: 'Документ',
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
 * Отказ `POST /meetings/:id/files`. Проверка формата и размера до отправки —
 * фаза 5; пока api принимает что угодно, и осмысленных причин отказа ровно две:
 * связи нет и встречи больше нет.
 */
export const describeUploadFailure = (error: unknown): string => {
  switch (statusOf(error)) {
    case undefined:
      return NO_CONNECTION_MESSAGE
    case 404:
      return 'Встреча не найдена — возможно, её удалили.'
    default:
      return 'Файл не загрузился. Попробуйте ещё раз.'
  }
}
