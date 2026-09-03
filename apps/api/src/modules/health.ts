import { Elysia, t } from 'elysia'

export const healthModule = new Elysia({ prefix: '/health', tags: ['Health'] }).get(
  '',
  () => ({
    status: 'ok' as const,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  }),
  {
    detail: { summary: 'Liveness probe' },
    response: t.Object({
      status: t.Literal('ok'),
      uptime: t.Number(),
      timestamp: t.String(),
    }),
  },
)
