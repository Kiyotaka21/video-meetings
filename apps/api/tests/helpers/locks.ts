import { prisma } from '../../src/db/prisma'

/**
 * Ждёт, пока какой-нибудь запрос в нашей базе встанет в очередь за замком.
 * Нужен тестам, которые разыгрывают гонку сами: «соседний запрос» держит
 * транзакцию с замком, и коммитить её можно только когда проверяемый запрос уже
 * ждёт за ним.
 *
 * Опрашиваем `pg_stat_activity`, а не спим наугад: на медленной машине «100 мс»
 * не хватит, и тест на гонку молча перестанет её проверять. Тестовые файлы
 * `bun test` гоняет по очереди, так что чужих ожидающих здесь не бывает.
 */
export const waitForLockWaiter = async (): Promise<void> => {
  for (let attempt = 0; attempt < 250; attempt += 1) {
    const [row] = await prisma.$queryRaw<Array<{ waiting: number }>>`
      SELECT count(*)::int AS waiting FROM pg_stat_activity
      WHERE wait_event_type = 'Lock' AND datname = current_database()`

    if ((row?.waiting ?? 0) > 0) {
      return
    }

    await Bun.sleep(20)
  }

  throw new Error('Запрос так и не встал в очередь за замком')
}
