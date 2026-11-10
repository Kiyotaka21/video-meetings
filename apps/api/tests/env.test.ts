import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterAll, describe, expect, it } from 'bun:test'

/**
 * `src/config/env.ts` читает окружение один раз, на загрузке модуля, а в этом
 * процессе его уже загрузил preload. Поэтому каждый случай — отдельный процесс
 * `bun` из пустого каталога: Bun сам подгружает `.env` из рабочего каталога, и
 * локальный `apps/api/.env` подменил бы проверяемые значения.
 */

const ENV_MODULE = resolve(import.meta.dir, '../src/config/env.ts')
const APP_MODULE = resolve(import.meta.dir, '../src/app.ts')

const EMPTY_CWD = mkdtempSync(join(tmpdir(), 'video-meetings-env-'))

afterAll(() => rmSync(EMPTY_CWD, { recursive: true, force: true }))

/** Годный набор: тест убирает или подменяет в нём одну переменную. */
const VALID: Record<string, string> = {
  DATABASE_URL: 'postgresql://user:password@127.0.0.1:5432/never-connected',
  JWT_SECRET: 'x'.repeat(32),
}

interface Run {
  exitCode: number
  stdout: string
  stderr: string
}

const run = (script: string, variables: Record<string, string | undefined>): Run => {
  // Только то, без чего процесс не запустится (PATH, на Windows — SYSTEMROOT),
  // плюс проверяемые переменные: окружение тестового прогона сюда не течёт.
  const env: Record<string, string> = {}

  for (const name of ['PATH', 'Path', 'SYSTEMROOT', 'SystemRoot', 'TEMP', 'TMP']) {
    const value = process.env[name]

    if (value !== undefined) {
      env[name] = value
    }
  }

  for (const [name, value] of Object.entries(variables)) {
    if (value !== undefined) {
      env[name] = value
    }
  }

  const result = Bun.spawnSync([process.execPath, '-e', script], { cwd: EMPTY_CWD, env })

  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  }
}

const loadEnv = (variables: Record<string, string | undefined>, print = 'null'): Run =>
  run(
    `const { env } = await import(${JSON.stringify(ENV_MODULE)}); console.log(JSON.stringify(${print}))`,
    variables,
  )

describe('JWT_SECRET', () => {
  for (const [label, value] of [
    ['не задан', undefined],
    ['пустая строка', ''],
  ] as const) {
    it(`${label} — api не стартует и называет переменную`, () => {
      const result = loadEnv({ ...VALID, JWT_SECRET: value })

      expect(result.exitCode).not.toBe(0)
      expect(result.stderr).toContain('JWT_SECRET')
    })
  }

  it('значение из прежнего .env.example — api не стартует', () => {
    // Секрет из репозитория известен всем: с ним подделывается токен любого
    // пользователя. Скопированный по старому README `.env` несёт его до сих пор.
    const result = loadEnv({ ...VALID, JWT_SECRET: 'change-me-in-your-own-env' })

    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toContain('.env.example')
  })

  it('короче 32 байт — api не стартует, ровно 32 — стартует', () => {
    const short = loadEnv({ ...VALID, JWT_SECRET: 'x'.repeat(31) })
    const enough = loadEnv({ ...VALID, JWT_SECRET: 'x'.repeat(32) })

    expect(short.exitCode).not.toBe(0)
    expect(short.stderr).toContain('32')
    expect(enough.exitCode).toBe(0)
  })

  it('длина — в байтах UTF-8, а не в символах', () => {
    // 16 кириллических букв — 32 байта: ключ HS256 меряется байтами.
    expect(loadEnv({ ...VALID, JWT_SECRET: 'я'.repeat(16) }).exitCode).toBe(0)
    expect(loadEnv({ ...VALID, JWT_SECRET: 'я'.repeat(15) }).exitCode).not.toBe(0)
  })
})

describe('Остальное окружение', () => {
  it('без DATABASE_URL api не стартует', () => {
    const result = loadEnv({ ...VALID, DATABASE_URL: undefined })

    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toContain('DATABASE_URL')
  })

  it('дефолты: development, 7d, 15m, CORS — dev-сервер Nuxt', () => {
    const result = loadEnv(
      VALID,
      '{ nodeEnv: env.nodeEnv, jwt: env.jwtExpiresIn, link: env.fileLinkExpiresIn, cors: env.corsOrigins }',
    )

    expect(JSON.parse(result.stdout)).toEqual({
      nodeEnv: 'development',
      jwt: '7d',
      link: '15m',
      cors: ['http://localhost:5173'],
    })
  })

  it('CORS_ORIGINS режется по запятым, пробелы и пустые куски отбрасываются', () => {
    const result = loadEnv(
      { ...VALID, CORS_ORIGINS: ' http://a.example , ,http://b.example ' },
      'env.corsOrigins',
    )

    expect(JSON.parse(result.stdout)).toEqual(['http://a.example', 'http://b.example'])
  })

  it('относительный UPLOAD_DIR разворачивается в абсолютный от рабочего каталога', () => {
    const result = loadEnv({ ...VALID, UPLOAD_DIR: './uploads-here' }, 'env.uploadDir')

    expect(JSON.parse(result.stdout)).toBe(resolve(EMPTY_CWD, 'uploads-here'))
  })

  it('NODE_ENV=production выключает /docs и /docs/json', () => {
    // База не нужна: PrismaClient на адаптере не подключается, пока нет запроса.
    const result = run(
      `const { app } = await import(${JSON.stringify(APP_MODULE)});
       const statuses = [];
       for (const path of ['/docs', '/docs/json', '/health']) {
         statuses.push((await app.handle(new Request('http://localhost' + path))).status);
       }
       console.log(JSON.stringify(statuses))`,
      { ...VALID, NODE_ENV: 'production' },
    )

    expect(JSON.parse(result.stdout)).toEqual([404, 404, 200])
  })
})
