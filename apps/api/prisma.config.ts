import { defineConfig, env } from 'prisma/config'

// В Prisma 7 строка подключения живёт в конфиге CLI, а не в блоке datasource.
// `env()` из prisma/config читает .env сам, поэтому dotenv не нужен — но только
// когда CLI запущен под Bun: скрипты воркспейса зовут его как `bunx --bun prisma`.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
})
