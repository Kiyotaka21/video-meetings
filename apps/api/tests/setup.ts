/**
 * Preload для `bun test` (подключён в bunfig.toml).
 *
 * Тесты не должны зависеть от локального `.env`: секрет и окружение
 * фиксируются здесь. Файл обязан выполниться до первого импорта
 * `src/config/env.ts` — тот читает `Bun.env` один раз, на загрузке модуля.
 */
export const TEST_JWT_SECRET = 'test-jwt-secret-not-for-production'

Bun.env.NODE_ENV = 'test'
Bun.env.JWT_SECRET = TEST_JWT_SECRET
