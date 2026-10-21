import { existsSync, readdirSync } from 'node:fs'
import { basename, join } from 'node:path'

import { expect } from 'bun:test'

import { TEST_UPLOAD_DIR } from '../setup'
import { getJson, request, type ApiResponse } from './http'

/**
 * Общее для тестов аватара: загрузка, ответ о пользователе и то, что лежит на
 * диске. Каталог `avatars/` один на всех пользователей прогона, поэтому «на
 * диске ничего не осталось» проверяется сравнением списка до и после запроса,
 * а не пустым каталогом.
 */

export const AVATAR_PATH = '/auth/me/avatar'

/** Путь отдачи: `/avatars/` и 32 hex-символа ключа (128 бит) с расширением формата. */
export const AVATAR_URL = /^\/avatars\/[0-9a-f]{32}\.(jpg|png|webp)$/

export interface PublicUser {
  id: string
  email: string
  name: string | null
  avatarUrl: string | null
}

/** Ровно поля `GET /auth/me`: ответы `PUT` и `DELETE` обязаны отдавать тот же объект. */
export const asUser = (body: unknown): PublicUser => {
  expect(Object.keys(body as object).sort()).toEqual(['avatarUrl', 'email', 'id', 'name'])

  return body as PublicUser
}

export interface AvatarUpload {
  /** Сырые байты тела: массив, строка или поток — как их принимает `Request`. */
  body: RequestInit['body']
  /** Заявленный тип. `undefined` — клиент не прислал `Content-Type` вовсе. */
  type?: string
  /**
   * `Content-Length`. Сам `Request` его не ставит даже для массива, поэтому без
   * этого поля заголовка нет — как у chunked-загрузки.
   */
  declaredSize?: number
}

/** Загрузка аватара так же, как её шлёт браузер: тело — сами байты картинки. */
export const putAvatar = (upload: AvatarUpload, token?: string): Promise<ApiResponse> =>
  request(AVATAR_PATH, {
    method: 'PUT',
    headers: {
      ...(upload.type === undefined ? {} : { 'content-type': upload.type }),
      ...(upload.declaredSize === undefined
        ? {}
        : { 'content-length': String(upload.declaredSize) }),
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
    },
    body: upload.body,
  })

/** Картинка целиком, с честным `Content-Length` — так её шлёт браузер. */
export const imageUpload = (bytes: Uint8Array, type = 'image/png'): AvatarUpload => ({
  body: bytes,
  type,
  declaredSize: bytes.byteLength,
})

/** Ссылка на аватар, каким его видит `GET /auth/me`. */
export const currentAvatarUrl = async (token: string): Promise<string | null> => {
  const response = await getJson('/auth/me', token)

  expect(response.status).toBe(200)

  return asUser(response.body).avatarUrl
}

/** Загружает картинку и отдаёт ссылку на неё; ответ проверяется по дороге. */
export const uploadAvatar = async (token: string, bytes: Uint8Array): Promise<string> => {
  const response = await putAvatar(imageUpload(bytes), token)

  expect(response.status).toBe(200)

  const { avatarUrl } = asUser(response.body)

  expect(avatarUrl).toMatch(AVATAR_URL)

  return avatarUrl as string
}

/** Каталог аватаров на диске: путь целиком генерирует api, клиент его не видит. */
export const AVATARS_DIR = join(TEST_UPLOAD_DIR, 'avatars')

/** Что лежит в `avatars/`. Каталога нет — пустой список: его создаёт первая загрузка. */
export const storedAvatars = (): string[] =>
  existsSync(AVATARS_DIR) ? readdirSync(AVATARS_DIR).sort() : []

/** Файл на диске по ссылке: имя файла — последний сегмент пути отдачи. */
export const avatarFileOf = (url: string): string => join(AVATARS_DIR, basename(url))
