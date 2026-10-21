import { Elysia, t } from 'elysia'

import { prisma } from '../../db/prisma'
import { avatarFilePath, formatOfAvatarFile } from './storage'

/**
 * Аватар пользователя. Загрузка и удаление — под guard'ом, в `/auth/me/avatar`
 * (`src/modules/auth.ts`); здесь — отдача по открытой ссылке и её путь.
 *
 * `<img>` не шлёт `Authorization`, а файловый токен со сроком сломал бы
 * картинку на открытой странице через 15 минут и менял бы адрес на каждый
 * `/auth/me`, убивая кэш. Поэтому ссылка открытая, а доступ несёт сам адрес:
 * 128 бит случайного ключа, новые при каждой загрузке. Ни из id
 * пользователя, ни перебором его не составить; плата — картинку видит любой,
 * у кого есть ссылка.
 */

/**
 * Путь отдачи аватара от корня api — как `contentPath` у файлов встречи: под
 * каким origin'ом браузер видит api, сервер не знает, и фронтенд склеивает
 * путь со своим `apiUrl`. Ключ — имя файла целиком (`<ключ>.png`), в нём только
 * hex и расширение, кодировать нечего.
 */
export const avatarUrl = (avatarKey: string): string => `/avatars/${avatarKey}`

const messageResponse = t.Object({ message: t.String() })

/** Нет такого ключа, ключ чужой формы, файл пропал — снаружи неотличимы. */
const AVATAR_NOT_FOUND = { message: 'Avatar not found' } as const

/** ENOENT — файла на диске нет. */
const isFileMissing = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'

/**
 * Год — потолок, который понимают кэши, `immutable` — не перепроверять даже
 * при обновлении страницы. Так можно, потому что по одному адресу всегда одни
 * и те же байты: замена кладёт картинку под новый ключ, а старый адрес
 * начинает отвечать 404.
 */
const CACHE_FOREVER = 'public, max-age=31536000, immutable'

/**
 * Отдача — свой инстанс без guard'а, как `fileContentRoutes` у файлов встречи:
 * граница видна глазами, под guard'ом ровно то, что внутри инстанса.
 */
export const avatarsModule = new Elysia({
  name: 'avatars',
  prefix: '/avatars',
  tags: ['Avatars'],
}).get(
  '/:file',
  async ({ params, status }) => {
    // Имя чужой формы не доходит ни до базы, ни до диска.
    const format = formatOfAvatarFile(params.file)

    if (!format) {
      return status(404, AVATAR_NOT_FOUND)
    }

    // Отдаётся только то, на что указывает строка пользователя: файл без
    // строки (подобранный ключ, загрузка, чья транзакция не прошла, старый
    // ключ между коммитом замены и удалением файла) — 404.
    const owner = await prisma.user.findUnique({
      where: { avatarKey: params.file },
      select: { id: true },
    })

    if (!owner) {
      return status(404, AVATAR_NOT_FOUND)
    }

    // Байты, а не `new Response(Bun.file(...))`: такой ответ Elysia
    // переупаковывает в поток, и живой сервер выбрасывает явный
    // `Content-Length` и шлёт chunked — через `app.handle` этого не видно (см.
    // «Ловушки» в `apps/api/CLAUDE.md`). Аватар не больше 2 МБ, прочесть его
    // целиком дёшево.
    let bytes: Uint8Array

    try {
      bytes = await Bun.file(avatarFilePath(params.file)).bytes()
    } catch (error) {
      // Строка есть, файла нет: рассинхрон или замена, удалившая файл между
      // поиском строки и чтением. Для клиента — тот же 404.
      if (isFileMissing(error)) {
        return status(404, AVATAR_NOT_FOUND)
      }

      throw error
    }

    return new Response(bytes, {
      headers: {
        // Тип — функция формата, узнанного по содержимому при загрузке, а
        // `nosniff` не даёт браузеру передумать.
        'content-type': format.mimeType,
        'content-length': String(bytes.byteLength),
        'x-content-type-options': 'nosniff',
        'cache-control': CACHE_FOREVER,
        // Картинка по построению встраивается чужим origin'ом — `<img>` на
        // фронтенде (5173 против 3000). Без заголовка это и так работает,
        // но страница с `Cross-Origin-Embedder-Policy` или общий плагин
        // заголовков с `same-origin` молча сломали бы аватар.
        'cross-origin-resource-policy': 'cross-origin',
      },
    })
  },
  {
    params: t.Object({ file: t.String() }),
    response: {
      404: messageResponse,
    },
    detail: {
      summary: 'Get an avatar by its link',
      description:
        'Ссылку отдаёт `GET /auth/me` в поле `avatarUrl`. Открытая: доступ несёт ' +
        'случайный ключ в адресе, новый при каждой загрузке.',
    },
  },
)
