import { PrismaPg } from '@prisma/adapter-pg'

import { PrismaClient } from '../../generated/prisma/client'
import { env } from '../config/env'

/**
 * Единственный экземпляр клиента на процесс: внутри пул соединений, и второй
 * такой же открыл бы к базе ещё один. Импортируй отсюда, не создавай свой.
 *
 * У Prisma 7 нет Rust-движка, запросы исполняет драйверный адаптер — поэтому
 * `new PrismaClient()` без `adapter` здесь просто не заработает.
 */
export const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: env.databaseUrl }),
})
