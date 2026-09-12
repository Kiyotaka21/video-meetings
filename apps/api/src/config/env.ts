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
 * Запас над лимитом записи (2 ГиБ): Bun.serve обрывает тело сверх своего
 * `maxRequestBodySize` молчаливым закрытием сокета, без ответа. Держим его выше
 * нашего лимита, чтобы клиент получал наш 413 с текстом, а не «нет связи».
 */
const DEFAULT_MAX_REQUEST_BODY_SIZE = 2 * 1024 ** 3 + 64 * 1024 ** 2

export const env = {
  nodeEnv: Bun.env.NODE_ENV ?? 'development',
  host: Bun.env.HOST ?? '0.0.0.0',
  port: Number(Bun.env.PORT ?? 3000),
  corsOrigins: parseOrigins(Bun.env.CORS_ORIGINS ?? 'http://localhost:5173'),
  databaseUrl: required('DATABASE_URL', Bun.env.DATABASE_URL),
  jwtSecret: required('JWT_SECRET', Bun.env.JWT_SECRET),
  jwtExpiresIn: Bun.env.JWT_EXPIRES_IN ?? '7d',

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
