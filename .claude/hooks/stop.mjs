// Хук Stop: Ralph-цикл. Каждую открытую issue фазы делает отдельная сессия
// `claude -p`, а этот скрипт запускает следующую, когда предыдущая закончилась.
// Подключён из .claude/settings.json; что делать — в .claude/ralph.config.json,
// правила для самих сессий — в .claude/ralph.md.
//
//   bun .claude/hooks/stop.mjs --start         запустить цикл руками, счётчик с нуля
//   bun .claude/hooks/stop.mjs                 сам хук: продолжает цикл
//   bun .claude/hooks/stop.mjs --finish-phase  фоновый шаг: PR и ревью закрытой фазы
import { execFileSync, spawn } from 'node:child_process'
import {
  appendFileSync,
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptPath = fileURLToPath(import.meta.url)
const projectDir = process.env.CLAUDE_PROJECT_DIR || resolve(dirname(scriptPath), '../..')
const configFile = join(projectDir, '.claude', 'ralph.config.json')
// Состояние и лог — машинные файлы, оба в .gitignore.
const stateFile = join(projectDir, '.claude', 'ralph.iterations.json')
const logFile = join(projectDir, '.claude', 'ralph.log')

// Метка сессий, которые запустил сам цикл. Stop срабатывает в конце каждого
// ответа любой сессии, и без метки каждый ответ человеку в интерактивной сессии
// запускал бы ещё одного агента поверх уже работающего.
const LOOP_ENV = 'RALPH_LOOP'

const mode = process.argv[2] ?? 'hook'

// Опечатка в флаге не должна молча запускать цикл в обход метки.
if (!['hook', '--start', '--finish-phase'].includes(mode)) {
  console.error(`Неизвестный режим ${mode}: ждём --start или --finish-phase.`)
  process.exit(1)
}

if (mode === 'hook' && process.env[LOOP_ENV] !== '1') process.exit(0)

const config = JSON.parse(readFileSync(configFile, 'utf8'))
const phases = config.phases ?? [{ milestone: config.milestone, branch: config.branch }]

function log(message) {
  // У фонового шага stdout и так уходит в лог — строка задвоилась бы.
  if (mode !== '--finish-phase') console.log(message)
  appendFileSync(logFile, `[${new Date().toISOString()}] ${message}\n`)
}

function readState() {
  if (!existsSync(stateFile)) return { count: 0, phaseIndex: 0 }
  return JSON.parse(readFileSync(stateFile, 'utf8'))
}

function writeState(state) {
  writeFileSync(stateFile, `${JSON.stringify(state)}\n`)
}

/** Окружение для процессов, которые не должны продолжать цикл своим Stop. */
function envWithoutLoopMark() {
  const env = { ...process.env }
  delete env[LOOP_ENV]
  return env
}

function openIssues(milestone) {
  // execFileSync без шелла: в названиях milestone бывают обратные кавычки.
  const output = execFileSync(
    'gh',
    ['issue', 'list', '--milestone', milestone, '--state', 'open', '--json', 'number,title'],
    { cwd: projectDir, encoding: 'utf8' },
  )
  // gh отдаёт новые сверху, а задачи фазы идут по порядку номеров.
  return JSON.parse(output).sort((a, b) => a.number - b.number)
}

/**
 * Запускает процесс в фоне и сразу возвращает управление. Синхронный запуск
 * держал бы хук открытым всю сессию: дочерняя сессия вызывала бы этот же хук
 * изнутри, процессы вкладывались бы друг в друга, а таймаут хука обрывал бы
 * работу на середине. Вывод — в лог: унаследованный stdout хука Claude Code
 * ждал бы до конца дочернего процесса.
 */
function launch(command, args, env) {
  const out = openSync(logFile, 'a')
  const child = spawn(command, args, {
    cwd: projectDir,
    env,
    detached: true,
    stdio: ['ignore', out, out],
    windowsHide: true,
  })
  closeSync(out)
  child.on('error', (error) => log(`❌ Не удалось запустить ${command}: ${error.message}`))
  child.unref()
}

/** Синхронная сессия для фонового шага: там таймаута хука уже нет. */
function runClaude(prompt, maxTurns) {
  const out = openSync(logFile, 'a')
  try {
    execFileSync(
      'claude',
      ['-p', prompt, '--model', 'claude-opus-5-5', '--max-turns', String(maxTurns)],
      { cwd: projectDir, env: envWithoutLoopMark(), stdio: ['ignore', out, out] },
    )
  } finally {
    closeSync(out)
  }
}

function step(state) {
  const phase = phases[state.phaseIndex]
  if (!phase) {
    log('🎉 Все фазы завершены.')
    return
  }

  const issues = openIssues(phase.milestone)

  if (issues.length === 0) {
    log(`✅ Фаза ${state.phaseIndex + 1} завершена. В фоне создаём PR и ревью...`)
    launch(process.execPath, [scriptPath, '--finish-phase'], envWithoutLoopMark())
    return
  }

  // На лимите счётчик не сбрасывается: иначе следующий же Stop начал бы отсчёт
  // заново и цикл не остановился бы никогда. Обнуляет его только --start.
  if (state.count >= config.maxIterations) {
    log(
      `⛔ Лимит итераций (${config.maxIterations}) достигнут. Продолжить: bun .claude/hooks/stop.mjs --start`,
    )
    return
  }

  state.count++
  writeState(state)

  const next = issues[0]
  log(
    `🔄 Фаза ${state.phaseIndex + 1} — Итерация ${state.count}/${config.maxIterations} — Issue #${next.number}: ${next.title}`,
  )
  log(`📋 Осталось: ${issues.length}`)

  const prompt = config.prompt
    .replaceAll('{milestone}', phase.milestone)
    .replaceAll('{branch}', phase.branch)
  launch('claude', ['-p', prompt, '--max-turns', String(config.maxTurns)], {
    ...process.env,
    [LOOP_ENV]: '1',
  })
}

function finishPhase(state) {
  const phase = phases[state.phaseIndex]
  if (!phase) return

  runClaude(`Создай PR из ветки ${phase.branch} в main с названием 'feat: ${phase.milestone}'.`, 10)

  log('🔍 Ревью Opus 5.5...')
  runClaude(
    'Найди последний открытый PR и проведи детальное code review. Проверь архитектуру, безопасность, производительность и соответствие PRD. Оставь комментарии в PR через gh cli.',
    config.maxTurns,
  )

  state.phaseIndex++
  state.count = 0
  writeState(state)

  const nextPhase = phases[state.phaseIndex]
  if (nextPhase) log(`➡️ Фаза ${state.phaseIndex + 1}: ${nextPhase.milestone}`)
  step(state)
}

if (!config.active) {
  if (mode === '--start') log('Цикл выключен: active в .claude/ralph.config.json — false.')
  process.exit(0)
}

const state = readState()

if (mode === '--finish-phase') {
  finishPhase(state)
} else {
  if (mode === '--start') {
    state.count = 0
    writeState(state)
  }
  step(state)
  if (mode === '--start') console.log('Ход цикла — в .claude/ralph.log')
}
