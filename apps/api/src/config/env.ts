const parseOrigins = (value: string | undefined): string[] =>
  (value ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)

export const env = {
  nodeEnv: Bun.env.NODE_ENV ?? 'development',
  host: Bun.env.HOST ?? '0.0.0.0',
  port: Number(Bun.env.PORT ?? 3000),
  corsOrigins: parseOrigins(Bun.env.CORS_ORIGINS ?? 'http://localhost:5173'),
} as const

export const isProduction = env.nodeEnv === 'production'
