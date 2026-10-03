import { createHmac } from 'node:crypto'

import { jwt } from '@elysiajs/jwt'

import { env } from '../../config/env'

/**
 * Ссылка на файл для `<video>` и `<a href>`: они не умеют слать `Authorization`,
 * поэтому доступ несёт короткий токен в `?token=` с `sub` — id файла.
 *
 * Секрет выводится из `JWT_SECRET`, а не совпадает с ним (ресерч, 2.3). На
 * общем секрете guard `authenticated` принял бы файловый токен за сессию:
 * `GET /meetings` ответил бы 200 с пустым списком, `POST /meetings` —
 * пятисоткой. Claim вида `typ: 'file'` закрыл бы только одну сторону и только
 * пока о нём помнят; разные секреты делают перепутать токены невозможным, а
 * новой переменной окружения не требуют.
 *
 * Метка `file-link-v1` — часть контракта: сменишь её — протухнут все выданные
 * ссылки (что и нужно, если их надо отозвать разом).
 */
const FILE_LINK_SECRET = createHmac('sha256', env.jwtSecret)
  .update('file-link-v1')
  .digest('base64url')

/**
 * Свой инстанс плагина со своим именем: Elysia дедуплицирует плагины по имени,
 * и с именем `jwt` он слился бы с сессионным.
 */
export const fileLinkJwt = jwt({
  name: 'fileJwt',
  secret: FILE_LINK_SECRET,
  exp: env.fileLinkExpiresIn,
})

/** Путь отдачи от корня api — так же, как пути всех остальных маршрутов. */
export const contentPath = (meetingId: string, fileId: string): string =>
  `/meetings/${meetingId}/files/${fileId}/content`
