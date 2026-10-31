import { Buffer } from 'node:buffer'
import { deflateSync } from 'node:zlib'

/**
 * Картинки для тестов аватара собираются в коде, а не лежат бинарными
 * фикстурами: так видно, какие байты делают файл JPEG, PNG или WebP, а какие
 * нет. Api судит формат по сигнатуре начала файла, но картинки здесь
 * настоящие, минимальные — их можно открыть в браузере и убедиться, что тест
 * гоняет изображение, а не «байты с правильной шапкой».
 */

const ascii = (text: string): Uint8Array => new TextEncoder().encode(text)

const concat = (...parts: Uint8Array[]): Uint8Array => {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0))
  let offset = 0

  for (const part of parts) {
    result.set(part, offset)
    offset += part.byteLength
  }

  return result
}

const uint32 = (value: number): Uint8Array => {
  const bytes = new Uint8Array(4)
  new DataView(bytes.buffer).setUint32(0, value)

  return bytes
}

/** Блок PNG: длина, тип, данные и CRC-32 по типу с данными. */
const pngChunk = (type: string, data: Uint8Array): Uint8Array => {
  const typed = concat(ascii(type), data)

  return concat(uint32(data.byteLength), typed, uint32(Bun.hash.crc32(typed)))
}

/** PNG 1×1, RGB: сигнатура, IHDR, сжатая строка пикселей и IEND. */
export const png = (rgb: [number, number, number] = [79, 70, 229]): Uint8Array =>
  concat(
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    // Ширина 1, высота 1, 8 бит на канал, тип цвета 2 (RGB), без чересстрочности.
    pngChunk('IHDR', concat(uint32(1), uint32(1), new Uint8Array([8, 2, 0, 0, 0]))),
    // Строка начинается с байта фильтра 0, дальше три канала пикселя.
    pngChunk('IDAT', deflateSync(new Uint8Array([0, ...rgb]))),
    pngChunk('IEND', new Uint8Array()),
  )

/**
 * JPEG 1×1 в оттенках серого, baseline: таблица квантования из единиц и по
 * одному коду длиной 1 бит в таблицах Хаффмана — для DC (категория 0) и для
 * AC (конец блока). Скан — эти два кода, добитые единицами до байта.
 */
export const jpeg = (): Uint8Array => {
  const marker = (code: number, body: number[]): number[] => [
    0xff,
    code,
    (body.length + 2) >> 8,
    (body.length + 2) & 0xff,
    ...body,
  ]
  const singleCodeTable = (classAndId: number): number[] => [
    classAndId,
    1,
    ...Array<number>(15).fill(0),
    0x00,
  ]

  return new Uint8Array([
    0xff,
    0xd8, // SOI
    ...marker(0xdb, [0x00, ...Array<number>(64).fill(1)]), // DQT
    ...marker(0xc0, [8, 0, 1, 0, 1, 1, 1, 0x11, 0]), // SOF0: 1×1, одна компонента
    ...marker(0xc4, singleCodeTable(0x00)), // DHT, DC
    ...marker(0xc4, singleCodeTable(0x10)), // DHT, AC
    ...marker(0xda, [1, 1, 0x00, 0, 63, 0]), // SOS
    0x3f, // «0» — DC без разницы, «0» — конец блока, дальше единицы
    0xff,
    0xd9, // EOI
  ])
}

/**
 * WebP 1×1 без потерь (VP8L) — тот самый, по которому Google в своём FAQ
 * предлагает проверять поддержку WebP. Битовый поток VP8L руками не собрать
 * читаемо, поэтому он записан готовым: контейнер `RIFF…WEBP` видно и так.
 */
export const webp = (): Uint8Array =>
  Buffer.from('UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==', 'base64')

/** GIF 1×1 — формат, которого среди аватаров нет: анимации PRD не принимает. */
export const gif = (): Uint8Array =>
  Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64')

/** SVG — текст, и встроенный скрипт исполнился бы на origin'е api. */
export const svg = (): Uint8Array =>
  ascii(
    '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><script>alert(1)</script></svg>',
  )

/**
 * Начало HEIC — коробка `ftyp` контейнера ISO BMFF с брендом `heic`. По ней
 * формат и узнаётся; остальное содержимое для отказа не нужно.
 */
export const heic = (): Uint8Array =>
  concat(uint32(24), ascii('ftypheic'), uint32(0), ascii('mif1heic'))

/** WAV — тоже контейнер RIFF, как WebP: отличается только меткой в байтах 8–11. */
export const wav = (): Uint8Array => concat(ascii('RIFF'), uint32(4), ascii('WAVE'))

/** Текст, который клиент назвал картинкой: расширение и тип тут ничего не решают. */
export const text = (): Uint8Array => ascii('это не картинка, а текст в файле avatar.png')

/**
 * Картинка, добитая нулями до `size` байт. Хвост за концом изображения
 * декодеры пропускают, а api считает весь размер тела — так лимит
 * проверяется на настоящей сигнатуре.
 */
export const padded = (image: Uint8Array, size: number): Uint8Array => {
  const result = new Uint8Array(size)
  result.set(image)

  return result
}

/**
 * Тело-поток из картинки и нулей до `size` байт, чанками по 1 МиБ. Поток, а не
 * массив: `Request` с потоком не получает `Content-Length` — так выглядит
 * chunked-загрузка, которую ловит только счётчик в потоке.
 */
export const paddedStream = (image: Uint8Array, size: number): ReadableStream<Uint8Array> => {
  const chunkSize = 1024 * 1024
  let offset = 0

  return new ReadableStream({
    pull(controller) {
      if (offset >= size) {
        controller.close()

        return
      }

      const length = Math.min(chunkSize, size - offset)
      const chunk = new Uint8Array(length)
      const head = image.subarray(offset, offset + length)

      chunk.set(head)
      controller.enqueue(chunk)
      offset += length
    },
  })
}
