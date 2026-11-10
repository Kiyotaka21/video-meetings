/**
 * Preload для `bun test` (подключён в bunfig.toml).
 *
 * Тесты не должны зависеть от локального `.env`: секрет и окружение
 * фиксируются здесь. Файл обязан выполниться до первого импорта
 * `src/config/env.ts` — тот читает `Bun.env` один раз, на загрузке модуля.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll } from 'bun:test'

export const TEST_JWT_SECRET = 'test-jwt-secret-not-for-production'

/**
 * Загрузки уезжают во временный каталог: прогон не должен оставлять файлы в
 * рабочем `.uploads`, а тесты — натыкаться на чужие следы от прошлого запуска.
 */
export const TEST_UPLOAD_DIR = mkdtempSync(join(tmpdir(), 'video-meetings-uploads-'))

/** Origin фронтенда, которому api отдаёт CORS-заголовки, — дефолт `CORS_ORIGINS`. */
export const TEST_FRONTEND_ORIGIN = 'http://localhost:5173'

Bun.env.NODE_ENV = 'test'
Bun.env.JWT_SECRET = TEST_JWT_SECRET
Bun.env.UPLOAD_DIR = TEST_UPLOAD_DIR

// Сроки и origin тесты сверяют числами: «7 дней», «15 минут», ровно этот
// origin. Без явной фиксации их подменил бы локальный `.env` — Bun читает его
// сам, — и `FILE_LINK_EXPIRES_IN=1h` у разработчика ронял бы тесты, которые
// ничего не сломали.
Bun.env.JWT_EXPIRES_IN = '7d'
Bun.env.FILE_LINK_EXPIRES_IN = '15m'
Bun.env.CORS_ORIGINS = TEST_FRONTEND_ORIGIN

// В preload-файле `afterAll` срабатывает один раз на весь прогон, после
// последнего теста, — поэтому уборка живёт здесь, а не в каждом тестовом файле.
afterAll(() => rmSync(TEST_UPLOAD_DIR, { recursive: true, force: true }))
