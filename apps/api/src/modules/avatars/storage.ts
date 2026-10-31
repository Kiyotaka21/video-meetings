import { randomBytes } from 'node:crypto'
import { mkdir, rename, rm, unlink } from 'node:fs/promises'

import { AVATARS_DIRECTORY, insideUploadDir, writeBody } from '../files/storage'
import {
  AVATAR_FORMATS,
  type AvatarFormat,
  detectAvatarFormat,
  MAX_AVATAR_SIZE,
  SIGNATURE_LENGTH,
} from './formats'

/**
 * Аватар на диске: `<UPLOAD_DIR>/avatars/<ключ>.<ext>`, рядом с каталогами
 * встреч. Запись тела — та же `writeBody`, что у файлов встречи: потоком, со
 * счётчиком на лимит и уборкой `.part` при обрыве.
 */

/** Абсолютный путь файла аватара. Ключ генерирует api, проверка пути всё равно стоит. */
export const avatarFilePath = (avatarKey: string): string =>
  insideUploadDir(AVATARS_DIRECTORY, avatarKey)

/** 128 бит — 32 hex-символа в ключе. */
const KEY_BYTES = 16

/**
 * 128 бит из CSPRNG в hex — новые при каждой загрузке. Не uuid v7: его первые
 * 48 бит — время загрузки, и половину адреса можно угадать. Не id
 * пользователя: его знает любой, кому он хоть раз попался, и адрес чужого
 * аватара составлялся бы без ссылки. Hex, а не base64url: на Windows имена
 * файлов регистронезависимы, и два ключа, различающиеся регистром, легли бы в
 * один файл.
 */
const randomKey = (): string => randomBytes(KEY_BYTES).toString('hex')

/** Имя файла аватара целиком: ключ в hex строчными и расширение формата. */
const AVATAR_FILE_NAME = new RegExp(`^[0-9a-f]{${KEY_BYTES * 2}}(\\.[a-z]+)$`)

/**
 * Формат файла по имени из адреса отдачи — или `null`, если имя не похоже на
 * то, что выдаёт api. Проверка до базы и до диска: `..`, слеши, нулевые байты,
 * `.part`, чужое расширение и другой регистр отсекаются здесь, а не путём на
 * диске (на Windows `<ключ>.PNG` открыл бы тот же файл).
 */
export const formatOfAvatarFile = (fileName: string): AvatarFormat | null => {
  const extension = AVATAR_FILE_NAME.exec(fileName)?.[1]

  return AVATAR_FORMATS.find((format) => format.extension === extension) ?? null
}

export type ReceivedAvatar =
  { avatarKey: string } | { refused: 'too-large' | 'incomplete' | 'unsupported' }

/**
 * Принимает тело запроса и кладёт картинку под новым ключом. Отказ — после
 * уборки: ни `.part`, ни готового файла от отказанной загрузки на диске нет.
 *
 * Формат узнаётся по первым байтам уже записанного файла: тело до 2 МБ, и
 * прочесть его начало с диска дешевле, чем склеивать поток заново после
 * подсмотренного первого чанка. Расширение файла — от формата, так что ключ
 * становится известен только после записи.
 */
export const receiveAvatar = async (
  body: ReadableStream<Uint8Array> | null,
  declaredSize: string | undefined,
): Promise<ReceivedAvatar> => {
  // FileSink родительский каталог не создаёт — без mkdir первая загрузка
  // падает с ENOENT.
  await mkdir(insideUploadDir(AVATARS_DIRECTORY), { recursive: true })

  const key = randomKey()
  const partPath = avatarFilePath(`${key}.part`)
  const size = await writeBody(body, partPath, MAX_AVATAR_SIZE)

  if (size === null) {
    return { refused: 'too-large' }
  }

  try {
    // Тело короче своего `Content-Length` — картинка неполная, что бы ни
    // случилось с соединением (ресерч загрузки файлов, замер 20). Заголовка
    // нет (chunked) — сверять не с чем.
    if (declaredSize !== undefined && Number(declaredSize) !== size) {
      await unlink(partPath)

      return { refused: 'incomplete' }
    }

    const format = detectAvatarFormat(await Bun.file(partPath).slice(0, SIGNATURE_LENGTH).bytes())

    if (!format) {
      await unlink(partPath)

      return { refused: 'unsupported' }
    }

    const avatarKey = `${key}${format.extension}`

    // Файл получает имя до того, как ключ попадёт в базу: пока строки нет,
    // отдача на него не попадает — она ищет строку раньше диска.
    await rename(partPath, avatarFilePath(avatarKey))

    return { avatarKey }
  } catch (error) {
    await unlink(partPath).catch(() => {})

    throw error
  }
}

/**
 * Убирает файл аватара. Пропавший уже файл — не ошибка (`force`): строка к
 * этому моменту указывает на другой ключ или на `null`, и цель «файла нет»
 * достигнута.
 */
export const removeAvatarFile = async (avatarKey: string): Promise<void> => {
  await rm(avatarFilePath(avatarKey), { force: true })
}
