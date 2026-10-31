/**
 * Форматы и лимит аватара — в одном месте: отсюда их читают и обработчик, и
 * тесты.
 *
 * В отличие от файлов встречи, формат решает содержимое, а не расширение и не
 * заявленный тип: имени файла api не принимает вовсе, а картинка рисуется на
 * наших страницах, и `.png` с HTML внутри здесь не должен пройти никак. Прочесть
 * начало файла до 2 МБ дёшево; у записей на 2 ГБ разбор сигнатуры осознанно не
 * делался.
 *
 * Фронтенд держит копию лимита и текстов для проверки до отправки —
 * `apps/web/app/utils/profile.ts`, формат там судится по расширению: разъезд
 * не поймают ни типы, ни сборка.
 */

/** 2 МиБ — столько файловый менеджер и наш интерфейс показывают как «2 МБ». */
export const MAX_AVATAR_SIZE = 2 * 1024 ** 2

/** Тексты отказов — по-русски и для показа как есть, как 415/413 у файлов встречи. */
export const AVATAR_TOO_LARGE = 'Изображение больше 2 МБ'

export const AVATAR_UNSUPPORTED = 'Подходят только изображения JPEG, PNG и WebP'

export const AVATAR_INCOMPLETE = 'Изображение пришло не целиком — загрузите его ещё раз'

export interface AvatarFormat {
  /** Расширение файла на диске и в пути отдачи. */
  extension: string
  /** `Content-Type` при отдаче — функция формата, а не того, что заявил клиент. */
  mimeType: string
  /** Узнаёт формат по первым байтам файла. */
  matches: (head: Uint8Array) => boolean
}

const startsWith = (head: Uint8Array, signature: readonly number[], offset = 0): boolean =>
  signature.every((byte, index) => head[offset + index] === byte)

const ascii = (text: string): number[] => [...text].map((char) => char.charCodeAt(0))

/**
 * Сигнатуры трёх форматов из PRD. GIF, SVG, HEIC и всё остальное под них не
 * подходит и получает 415: анимаций PRD не принимает, а SVG, открытый
 * напрямую с origin'а api, исполнил бы встроенный скрипт.
 */
export const AVATAR_FORMATS: readonly AvatarFormat[] = [
  {
    extension: '.jpg',
    mimeType: 'image/jpeg',
    // SOI и начало следующего маркера.
    matches: (head) => startsWith(head, [0xff, 0xd8, 0xff]),
  },
  {
    extension: '.png',
    mimeType: 'image/png',
    matches: (head) => startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  },
  {
    extension: '.webp',
    mimeType: 'image/webp',
    // RIFF — общий контейнер (в нём же WAV и AVI): WebP отличает только метка
    // в байтах 8–11, между ними — длина.
    matches: (head) => startsWith(head, ascii('RIFF')) && startsWith(head, ascii('WEBP'), 8),
  },
]

/** Сколько байт начала файла нужно, чтобы узнать любой из форматов. */
export const SIGNATURE_LENGTH = 12

/** Формат по первым байтам файла или `null`, если это не JPEG, PNG и не WebP. */
export const detectAvatarFormat = (head: Uint8Array): AvatarFormat | null =>
  AVATAR_FORMATS.find((format) => format.matches(head)) ?? null
