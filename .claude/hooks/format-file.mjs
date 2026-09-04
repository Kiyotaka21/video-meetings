// Хук PostToolUse: прогоняет Prettier по файлу, который агент только что записал.
// Подключён из .claude/settings.json на matcher Write|Edit|NotebookEdit.
//
// Разбор входа делает bun, а не jq: jq в окружении может не стоять, а bun в этом
// репозитории обязателен и так.
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// CLAUDE_PROJECT_DIR выставляет Claude Code; фолбэк — от места самого скрипта,
// чтобы хук работал и при ручном запуске.
const projectDir =
  process.env.CLAUDE_PROJECT_DIR || resolve(dirname(fileURLToPath(import.meta.url)), '../..')

// Точка входа пакета, а не shim из node_modules/.bin: у bun на Windows это .exe,
// у npm — .cmd, и оба пришлось бы запускать по-разному.
const prettierCli = join(projectDir, 'node_modules', 'prettier', 'bin', 'prettier.cjs')

/** Хук не должен ломать ход агента: любая наша неудача — тихий выход с кодом 0. */
function giveUp() {
  process.exit(0)
}

async function readStdin() {
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8')
}

let payload
try {
  payload = JSON.parse(await readStdin())
} catch {
  giveUp()
}

// Write отдаёт путь в tool_response.filePath, Edit — в tool_input.file_path.
const filePath = payload?.tool_response?.filePath ?? payload?.tool_input?.file_path
if (typeof filePath !== 'string' || filePath === '') giveUp()

const absolute = resolve(projectDir, filePath)
const inside = relative(projectDir, absolute)

// Файл вне репозитория (скретчпад, ~/.claude) форматировать нечем: до него не
// достаёт наш .prettierrc.json.
if (inside.startsWith('..') || !existsSync(absolute)) giveUp()

// bun install ещё не выполняли — молчим, а не сыпем ошибками на каждую правку.
if (!existsSync(prettierCli)) giveUp()

// --ignore-unknown: png, .env и прочее Prettier не умеет, но падать на них не
// должен. --ignore-path не передаём: из cwd Prettier сам подхватит
// .prettierignore, поэтому .agents/ и .claude/skills/ останутся нетронутыми.
// --log-level warn убирает строку «файл 12ms» из транскрипта.
const { status, stderr } = spawnSync(
  process.execPath,
  [prettierCli, '--write', '--ignore-unknown', '--no-color', '--log-level', 'warn', absolute],
  { cwd: projectDir, encoding: 'utf8' },
)

if (status === 0) giveUp()

// Ненулевой код — почти всегда синтаксическая ошибка в только что записанном
// файле. Говорим об этом модели: правка сломала парсинг, это надо починить.
// codeframe Prettier красит даже при --no-color, поэтому чистим escape-коды сами.
// ESC берём через fromCharCode: литерал \x1b в регулярке ловит no-control-regex.
const ansiCodes = new RegExp(`${String.fromCharCode(27)}[[][0-9;]*m`, 'g')
const reason = (stderr || '').replace(ansiCodes, '').trim().slice(0, 2000)

process.stdout.write(
  JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      additionalContext: `Prettier не смог отформатировать ${inside}:\n${reason}`,
    },
  }),
)
process.exit(0)
