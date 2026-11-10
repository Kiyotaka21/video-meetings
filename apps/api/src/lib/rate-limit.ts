/**
 * Счётчик попыток в фиксированном окне, в памяти процесса.
 *
 * В памяти, а не в базе: api — один процесс, а счётчик, который переживает
 * перезапуск, здесь не нужен — окно в минутах. Станет инстансов несколько —
 * счётчик переедет в общее хранилище, а интерфейс останется этим.
 *
 * Окно фиксированное, а не скользящее: на стыке окон проходит до двух лимитов
 * подряд. Для отсечки перебора это неважно, а запись — одна пара чисел на ключ.
 */

export interface RateLimiterOptions {
  /** Сколько попыток помещается в окно. */
  limit: number
  windowMs: number
  /** Потолок числа ключей: поток уникальных ключей не раздует процесс. */
  maxKeys?: number
  /** Часы — параметром, иначе окно не проверить без ожидания. */
  now?: () => number
}

export interface RateLimiter {
  /** Секунды до конца окна, если ключ исчерпал лимит; `0` — можно. */
  retryAfter: (key: string) => number
  /** Засчитывает попытку. */
  hit: (key: string) => void
  /** Забывает ключ: например, после удачного входа. */
  reset: (key: string) => void
}

const DEFAULT_MAX_KEYS = 100_000

export const createRateLimiter = ({
  limit,
  windowMs,
  maxKeys = DEFAULT_MAX_KEYS,
  now = Date.now,
}: RateLimiterOptions): RateLimiter => {
  const windows = new Map<string, { count: number; resetAt: number }>()

  const current = (key: string) => {
    const window = windows.get(key)

    if (window && window.resetAt <= now()) {
      windows.delete(key)

      return undefined
    }

    return window
  }

  /**
   * Сначала выбрасываются истёкшие окна, потом — самые старые: `Map` хранит
   * порядок вставки. Вытеснение обнуляет чужой счётчик, но чтобы вытеснить
   * нужный ключ, придётся прислать `maxKeys` попыток с другими ключами — и
   * каждую остановит свой лимит.
   */
  const makeRoom = () => {
    if (windows.size < maxKeys) {
      return
    }

    for (const [key, window] of windows) {
      if (window.resetAt <= now()) {
        windows.delete(key)
      }
    }

    for (const key of windows.keys()) {
      if (windows.size < maxKeys) {
        break
      }

      windows.delete(key)
    }
  }

  return {
    retryAfter: (key) => {
      const window = current(key)

      return window && window.count >= limit ? Math.ceil((window.resetAt - now()) / 1000) : 0
    },
    hit: (key) => {
      const window = current(key)

      if (window) {
        window.count += 1

        return
      }

      makeRoom()
      windows.set(key, { count: 1, resetAt: now() + windowMs })
    },
    reset: (key) => {
      windows.delete(key)
    },
  }
}

/** Отказ «слишком часто» — по-русски, для показа как есть, с ожиданием в минутах. */
export const tooManyAttempts = (subject: string, retryAfterSeconds: number): string =>
  `${subject} Попробуйте через ${Math.max(1, Math.ceil(retryAfterSeconds / 60))} мин.`
