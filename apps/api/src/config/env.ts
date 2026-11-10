import { resolve } from 'node:path'

const parseOrigins = (value: string | undefined): string[] =>
  (value ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)

/**
 * Для секретов и строк подключения дефолта нет: молчаливый фолбэк доезжает до
 * production и там уже выглядит как рабочая конфигурация.
 */
const required = (name: string, value: string | undefined): string => {
  if (!value) {
    throw new Error(`Не задана переменная окружения ${name} — смотри apps/api/.env.example`)
  }

  return value
}

/**
 * Значение, которое когда-то стояло в `.env.example`. Сам пример теперь
 * пустой, но `.env`, скопированные с прежней версии, несут его до сих пор, а
 * секрет из репозитория известен всем: с ним подделывается токен любого
 * пользователя и любая ссылка на файл.
 */
const EXAMPLE_JWT_SECRET = 'change-me-in-your-own-env'

/** 256 бит — ключ HS256 не короче выхода SHA-256 (RFC 7518, 3.2). */
export const MIN_JWT_SECRET_BYTES = 32

/**
 * Секрет подписи обязан быть непредсказуемым, а не только непустым: короткий
 * перебирается офлайн по любому выданному токену, а из примера — известен.
 */
const jwtSecret = (value: string | undefined): string => {
  const secret = required('JWT_SECRET', value)

  if (secret === EXAMPLE_JWT_SECRET) {
    throw new Error('JWT_SECRET взят из .env.example — сгенерируй свой: openssl rand -base64 48')
  }

  if (Buffer.byteLength(secret) < MIN_JWT_SECRET_BYTES) {
    throw new Error(
      `JWT_SECRET короче ${MIN_JWT_SECRET_BYTES} байт — сгенерируй свой: openssl rand -base64 48`,
    )
  }

  return secret
}

/**
 * Потолок тела у Bun.serve — не «чуть выше лимита записи», а далеко за любым
 * правдоподобным файлом. Запрос с `Content-Length` сверх потолка Bun отбивает
 * сам, до обработчика: его 413 уходит без CORS-заголовков, а соединение
 * рвётся посреди отправки, и браузер видит «нет связи» вместо «Файл больше
 * 2 ГБ» (замер 18 в ресерче: так было с записью на 2.1 ГиБ при потолке
 * 2 ГиБ + 64 МиБ). Наши 413 по заявленному размеру и по счётчику в потоке
 * срабатывают раньше, если запрос до них доходит.
 */
const DEFAULT_MAX_REQUEST_BODY_SIZE = 64 * 1024 ** 3

export const env = {
  nodeEnv: Bun.env.NODE_ENV ?? 'development',
  host: Bun.env.HOST ?? '0.0.0.0',
  port: Number(Bun.env.PORT ?? 3000),
  corsOrigins: parseOrigins(Bun.env.CORS_ORIGINS ?? 'http://localhost:5173'),
  databaseUrl: required('DATABASE_URL', Bun.env.DATABASE_URL),
  jwtSecret: jwtSecret(Bun.env.JWT_SECRET),
  jwtExpiresIn: Bun.env.JWT_EXPIRES_IN ?? '7d',

  /**
   * Срок ссылки на файл (`url` в списке файлов). Минуты, а не часы: ссылка
   * утекает вместе с историей браузера и логами прокси. Формат — как у
   * `JWT_EXPIRES_IN`.
   */
  fileLinkExpiresIn: Bun.env.FILE_LINK_EXPIRES_IN ?? '15m',

  /**
   * Каталог загруженных файлов. Дефолт здесь осмыслен, в отличие от секретов:
   * отсутствие каталога дыры не создаёт, а падение api при старте на свежем
   * клоне — лишнее трение. Путь разворачивается в абсолютный один раз: рабочий
   * каталог у `bun run dev` и у тестов разный, и относительный уехал бы следом.
   */
  uploadDir: resolve(Bun.env.UPLOAD_DIR ?? './.uploads'),

  maxRequestBodySize: Number(Bun.env.MAX_REQUEST_BODY_SIZE ?? DEFAULT_MAX_REQUEST_BODY_SIZE),
} as const

export const isProduction = env.nodeEnv === 'production'
