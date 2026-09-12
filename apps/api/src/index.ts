import { app } from './app'
import { env } from './config/env'

app.listen({
  hostname: env.host,
  port: env.port,
  // Дефолт Bun.serve — 128 МиБ: без этой строки загрузка записи обрывается на
  // ней закрытием сокета, а не ответом api. Держим запас над лимитом записи.
  maxRequestBodySize: env.maxRequestBodySize,
})

console.log(`API is running at http://${env.host}:${env.port}`)
