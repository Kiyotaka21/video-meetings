import { randomUUID } from 'node:crypto'

import { expect } from 'bun:test'

import { postJson } from './http'

export interface TestUser {
  email: string
  token: string
}

/**
 * База между прогонами не чистится, поэтому у каждого теста свой адрес: иначе
 * второй запуск упрётся в пользователя, созданного первым.
 */
export const uniqueEmail = (): string => `e2e-${randomUUID()}@example.com`

const PASSWORD = 'correct-horse-battery'

/**
 * Заводит нового пользователя через публичный маршрут и отдаёт его токен.
 * Ходить в базу мимо API незачем: регистрация — такой же проверенный контракт.
 */
export const registerUser = async (): Promise<TestUser> => {
  const email = uniqueEmail()
  const response = await postJson('/auth/register', { email, password: PASSWORD })

  expect(response.status).toBe(201)

  const token = (response.body as { token?: unknown }).token
  expect(typeof token).toBe('string')

  return { email, token: String(token) }
}
