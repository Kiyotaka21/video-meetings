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

export const env = {
  nodeEnv: Bun.env.NODE_ENV ?? 'development',
  host: Bun.env.HOST ?? '0.0.0.0',
  port: Number(Bun.env.PORT ?? 3000),
  corsOrigins: parseOrigins(Bun.env.CORS_ORIGINS ?? 'http://localhost:5173'),
  databaseUrl: required('DATABASE_URL', Bun.env.DATABASE_URL),
  jwtSecret: required('JWT_SECRET', Bun.env.JWT_SECRET),
  jwtExpiresIn: Bun.env.JWT_EXPIRES_IN ?? '7d',
} as const

export const isProduction = env.nodeEnv === 'production'
