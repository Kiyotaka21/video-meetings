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

    const blob = Bun.file(avatarFilePath(params.file))

    // `Bun.file` на несуществующий путь даёт размер 0 и пустое тело без
    // ошибки (ресерч загрузки файлов, замер 10): без проверки рассинхрон
    // «строка есть, файла нет» отвечал бы пустой картинкой с 200.
    if (!(await blob.exists())) {
      return status(404, AVATAR_NOT_FOUND)
    }

    return new Response(blob, {
      headers: {
        // Тип — функция формата, узнанного по содержимому при загрузке, а
        // `nosniff` не даёт браузеру передумать.
        'content-type': format.mimeType,
        // Elysia переупаковывает ответ (в `set.headers` всегда CORS), и без
        // явной длины он ушёл бы chunked.
        'content-length': String(blob.size),
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
