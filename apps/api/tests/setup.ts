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

Bun.env.NODE_ENV = 'test'
Bun.env.JWT_SECRET = TEST_JWT_SECRET
Bun.env.UPLOAD_DIR = TEST_UPLOAD_DIR

// В preload-файле `afterAll` срабатывает один раз на весь прогон, после
// последнего теста, — поэтому уборка живёт здесь, а не в каждом тестовом файле.
afterAll(() => rmSync(TEST_UPLOAD_DIR, { recursive: true, force: true }))
