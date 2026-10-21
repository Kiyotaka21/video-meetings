import { rm, unlink } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative } from 'node:path'

import { env } from '../../config/env'

/**
 * Всё, что касается диска: где лежат файлы встречи, как в них пишется тело
 * запроса и как они убираются. Путь целиком генерирует api — исходное имя файла
 * сюда не доезжает ни в каком виде.
 *
 * Запись тела и проверку пути внутри `UPLOAD_DIR` переиспользует аватар
 * (`../avatars/storage.ts`): его файлы лежат в том же `UPLOAD_DIR`, рядом с
 * каталогами встреч.
 */

/**
 * Каталог аватаров внутри `UPLOAD_DIR`. Имя объявлено здесь, а не рядом с
 * аватаром: раскладку `UPLOAD_DIR` знает этот файл, и `meetingDirectory` обязан
 * его обходить.
 */
export const AVATARS_DIRECTORY = 'avatars'

/** 1 МиБ: столько же, сколько в замере памяти из ресерча. */
const HIGH_WATER_MARK = 1024 * 1024

/**
 * Пишет тело запроса в `.part` и возвращает число записанных байт — или `null`,
 * если тело вышло за `maxSize`. Тогда `.part` уже удалён.
 *
 * Файл публикуется переименованием уже после вставки строки в базу, поэтому
 * недописанного файла читатель не видит никогда: пока он пишется, его имени нет
 * ни в одной строке.
 */
export const writeBody = async (
  body: ReadableStream<Uint8Array> | null,
  partPath: string,
  maxSize: number,
): Promise<number | null> => {
  const writer = Bun.file(partPath).writer({ highWaterMark: HIGH_WATER_MARK })
  let size = 0
  let tooLarge = false

  try {
    if (body) {
      for await (const chunk of body) {
        size += chunk.byteLength

        // Счётчик обязателен и при проверенном `Content-Length`: заголовок
        // присылает клиент, и он может соврать или не прислать его вовсе.
        // Лишний чанк на диск не уходит, а выход из цикла отменяет поток —
        // остаток тела не читается.
        if (size > maxSize) {
          tooLarge = true
          break
        }

        // `await` обязателен, и это не стилистика: `write` возвращает промис,
        // когда запись отложена, и без ожидания цикл читает сокет быстрее, чем
        // пишет диск. Замер на файле 1 ГБ: +6 МБ RSS с `await` против +2423 МБ
        // без него. Ни типы, ни тесты на мелких файлах разницы не увидят.
        await writer.write(chunk)
      }
    }

    await writer.end()
  } catch (error) {
    // Клиент нажал «Отменить» или потерял сеть: цикл бросает AbortError.
    // Недописанный `.part` — наш мусор, убрать его больше некому.
    await writer.end()
    await unlink(partPath).catch(() => {})

    throw error
  }

  if (tooLarge) {
    await unlink(partPath).catch(() => {})

    return null
  }

  return size
}

/**
 * Путь собирается из проверенного id встречи, сгенерированного id файла и
 * ключа таблицы форматов, так что `../` из имени сюда не доедет по построению.
 * Проверка всё равно стоит: она переживёт правку, которая решит подставить в
 * путь что-нибудь пользовательское.
 */
const isInsideUploadDir = (target: string): boolean => {
  const inside = relative(env.uploadDir, target)

  return inside.length > 0 && !inside.startsWith('..') && !isAbsolute(inside)
}

/**
 * Абсолютный путь внутри `UPLOAD_DIR`. Выход за его пределы — не ошибка
 * клиента, а сломанный инвариант в нашем коде, поэтому исключение, а не 4xx.
 */
export const insideUploadDir = (...segments: string[]): string => {
  const target = join(env.uploadDir, ...segments)

  if (!isInsideUploadDir(target)) {
    throw new Error(`Путь файла вышел за пределы UPLOAD_DIR: ${target}`)
  }

  return target
}

/**
 * Каталог встречи: `<UPLOAD_DIR>/<id встречи>` — прямой потомок `UPLOAD_DIR`,
 * но не каталог аватаров. Id встречи — uuid и с `avatars` не совпадёт, но
 * кривой аргумент превратил бы `removeMeetingFiles` в `rm -rf` аватаров всех
 * пользователей, а вложенный путь — в удаление одного чужого файла. Регистр не
 * учитывается: на Windows `Avatars` — тот же каталог.
 */
export const meetingDirectory = (meetingId: string): string => {
  const directory = insideUploadDir(meetingId)

  if (
    dirname(directory) !== env.uploadDir ||
    basename(directory).toLowerCase() === AVATARS_DIRECTORY
  ) {
    throw new Error(`Это не каталог встречи: ${directory}`)
  }

  return directory
}

/**
 * Абсолютный путь по относительному из метаданных. В базе он всегда со слэшем
 * (`<id встречи>/<id файла><расширение>`), `join` сам переведёт его в
 * разделители машины.
 */
export const storedPath = (relativePath: string): string => insideUploadDir(relativePath)

/**
 * Убирает файл с диска. Пропавший уже файл — не ошибка (`force`): строки в базе
 * к этому моменту нет, и цель «файла нет» достигнута.
 */
export const removeStoredFile = async (relativePath: string): Promise<void> => {
  await rm(storedPath(relativePath), { force: true })
}

/**
 * Убирает каталог встречи целиком — вместе с `.part` от загрузок, оборванных
 * падением процесса: у них нет строки в базе, и подобрать их больше некому.
 * `force` делает функцию идемпотентной.
 *
 * **Роута удаления встречи пока нет, и функцию зовут только тесты.** Появится
 * `DELETE /meetings/:id` — он обязан звать её после удаления строки встречи:
 * каскад в базе убирает строки файлов, но не сами файлы, и без этого вызова
 * каталоги остаются на диске навсегда.
 *
 * `meetingDirectory` отказывается от пустого id, от `..` и от каталога
 * аватаров: иначе кривой аргумент превратился бы в `rm -rf UPLOAD_DIR` или в
 * удаление аватаров всех пользователей.
 */
export const removeMeetingFiles = async (meetingId: string): Promise<void> => {
  await rm(meetingDirectory(meetingId), { recursive: true, force: true })
}
