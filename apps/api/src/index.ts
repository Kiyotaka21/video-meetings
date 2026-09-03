import { app } from './app'
import { env } from './config/env'

app.listen({ hostname: env.host, port: env.port })

console.log(`API is running at http://${env.host}:${env.port}`)
