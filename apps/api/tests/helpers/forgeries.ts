import { createHmac } from 'node:crypto'

import { TEST_JWT_SECRET } from '../setup'
import { decodeJwt, signJwt, unsignedJwt } from './jwt'

/**
 * Секрет файловых ссылок тест выводит сам, а не берёт из кода: контракт — HMAC
 * от `JWT_SECRET` с меткой `file-link-v1`, и подмена его на сам `JWT_SECRET`
 * должна ронять тесты.
 */
export const FILE_LINK_SECRET = createHmac('sha256', TEST_JWT_SECRET)
  .update('file-link-v1')
  .digest('base64url')

const nowSeconds = (): number => Math.floor(Date.now() / 1000)

/** Claims настоящего токена, выданного api, — с живым `sub` и верной `ver`. */
const claimsOf = (genuine: string): Record<string, unknown> => ({ ...decodeJwt(genuine).payload })

/** Тот же токен, подписанный заново, — с правками claims поверх настоящих. */
export const resign = (
  genuine: string,
  secret: string,
  overrides: Record<string, unknown> = {},
): string => signJwt({ ...claimsOf(genuine), ...overrides }, secret)

/**
 * Подделки сессионного токена, которые guard обязан отбить. Каждая собрана из
 * настоящего токена живого пользователя и отличается от него ровно одним:
 * подписью, алгоритмом, сроком или `sub`. Так 401 доказывает, что сработала
 * именно эта проверка, — а не поиск пользователя по случайному `sub`, который
 * отбил бы токен и без проверки подписи.
 *
 * Контрольный случай — тот же payload, подписанный нашим секретом, — каждый
 * набор тестов держит рядом: без него подделка «проходит» отказом и тогда,
 * когда сломан сам токен.
 */
export const SESSION_FORGERIES: ReadonlyArray<[string, (genuine: string) => string]> = [
  ['мусор вместо токена', () => 'not-a-jwt-at-all'],
  ['подпись чужим секретом', (genuine) => resign(genuine, 'secret-from-another-service')],
  // На общем секрете guard принял бы файловый токен за сессию — и наоборот.
  ['подпись секретом файловых ссылок', (genuine) => resign(genuine, FILE_LINK_SECRET)],
  [
    'истёкший токен',
    (genuine) =>
      resign(genuine, TEST_JWT_SECRET, { iat: nowSeconds() - 3600, exp: nowSeconds() - 60 }),
  ],
  ['alg: none без подписи', (genuine) => unsignedJwt(claimsOf(genuine))],
  // `undefined` выпадает из JSON: в payload'е `sub` нет вовсе.
  [
    'подпись нашим секретом, но без sub',
    (genuine) => resign(genuine, TEST_JWT_SECRET, { sub: undefined }),
  ],
]

/** Контроль к `SESSION_FORGERIES`: те же claims, наша подпись — guard обязан пропустить. */
export const resignedGenuine = (genuine: string): string => resign(genuine, TEST_JWT_SECRET)
