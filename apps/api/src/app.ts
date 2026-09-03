import { cors } from '@elysiajs/cors'
import { openapi } from '@elysiajs/openapi'
import { Elysia } from 'elysia'

import { env, isProduction } from './config/env'
import { healthModule } from './modules/health'

export const app = new Elysia()
  .use(
    cors({
      origin: env.corsOrigins,
      credentials: true,
    }),
  )
  .use(
    openapi({
      path: '/docs',
      documentation: {
        info: {
          title: 'Video Meetings API',
          version: '0.0.0',
        },
      },
      // Спека и Scalar UI нужны только в разработке.
      enabled: !isProduction,
    }),
  )
  .use(healthModule)

export type App = typeof app
