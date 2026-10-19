// Запуск Ralph-цикла с первой фазы: сбрасывает и счётчик итераций, и номер
// фазы, а дальше отдаёт управление `stop.mjs --start`. Сессий сам не запускает:
// метка RALPH_LOOP, фоновый запуск и лог живут в одном месте — в хуке, и второй
// путь запуска разошёлся бы с ним при первой же правке.
//
//   bun .claude/ralph-start.mjs                цикл с первой фазы ralph.config.json
//   bun .claude/hooks/stop.mjs --start         продолжить текущую фазу
import { spawnSync } from 'node:child_process'
import { readFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const claudeDir = dirname(fileURLToPath(import.meta.url))
const config = JSON.parse(readFileSync(join(claudeDir, 'ralph.config.json'), 'utf8'))

// При выключенном цикле stop.mjs ничего не запустит, а стёртый номер фазы уже
// не вернуть — поэтому проверка здесь, до сброса.
if (!config.active) {
  console.error('Цикл выключен: active в .claude/ralph.config.json — false.')
  process.exit(1)
}

// Без файла состояния stop.mjs начинает с первой фазы и нулевого счётчика.
rmSync(join(claudeDir, 'ralph.iterations.json'), { force: true })

const { status } = spawnSync(process.execPath, [join(claudeDir, 'hooks', 'stop.mjs'), '--start'], {
  cwd: dirname(claudeDir),
  stdio: 'inherit',
})
process.exit(status ?? 1)
