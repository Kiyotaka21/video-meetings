import { cors } from '@elysiajs/cors'
import { openapi } from '@elysiajs/openapi'
import { Elysia } from 'elysia'

import { env, isProduction } from './config/env'
import { authModule } from './modules/auth'
import { filesModule } from './modules/files'
import { healthModule } from './modules/health'
import { meetingsModule } from './modules/meetings'

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
        components: {
          securitySchemes: {
            bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
          },
        },
      },
      // Спека и Scalar UI нужны только в разработке.
      enabled: !isProduction,
    }),
  )
  .use(healthModule)
  .use(authModule)
  .use(meetingsModule)
  .use(filesModule)

export type App = typeof app
