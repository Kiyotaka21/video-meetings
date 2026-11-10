import { Elysia, t } from 'elysia'

import { prisma } from '../db/prisma'
import { isUuid } from '../lib/ids'
import { WITHOUT_CONTROL_CHARACTERS } from '../lib/text'
import { authenticated } from './auth'

/*
 * Удаления встречи здесь пока нет. Появится `DELETE /meetings/:id` — после
 * удаления строки он обязан звать `removeMeetingFiles(meetingId)` из
 * `./files/storage`: каскад в базе убирает строки файлов, но не сами файлы, и
 * без этого вызова каталог встречи остаётся в `UPLOAD_DIR` навсегда.
 */

const meetingInput = t.Object({
  // Без управляющих символов: NUL Postgres в тексте не принимает (была
  // пятисотка), а перевод строки ломает вывод в списке.
  title: t.String({ minLength: 1, maxLength: 200, pattern: WITHOUT_CONTROL_CHARACTERS }),
  date: t.String({ format: 'date-time' }),
  participants: t.Array(t.String({ format: 'email', maxLength: 254 }), { maxItems: 100 }),
})

const meetingResponse = t.Object({
  id: t.String(),
  title: t.String(),
  date: t.String(),
  participants: t.Array(t.String()),
  createdAt: t.String(),
})

const messageResponse = t.Object({ message: t.String() })

/** То, что уходит наружу: без `ownerId` — он и так равен текущему пользователю. */
const publicFields = {
  id: true,
  title: true,
  date: true,
  participants: true,
  createdAt: true,
} as const

interface MeetingRow {
  id: string
  title: string
  date: Date
  participants: string[]
  createdAt: Date
}

/**
 * Список отдаётся страницами: прошедшие встречи копятся без предела, а кабинет
 * показывает из них три. Без страниц каждое открытие `/` тянуло бы все встречи
 * за годы вместе с участниками.
 */
export const DEFAULT_PAGE_SIZE = 20
export const MAX_PAGE_SIZE = 100

const listQuery = t.Object({
  /** `upcoming` — с «сейчас» и дальше, ближайшие первыми; `past` — раньше, свежие первыми. */
  scope: t.Optional(t.Union([t.Literal('upcoming'), t.Literal('past')])),
  limit: t.Optional(t.Integer({ minimum: 1, maximum: MAX_PAGE_SIZE })),
  /** `nextCursor` предыдущей страницы как есть. */
  cursor: t.Optional(t.String()),
})

const meetingsPage = t.Object({
  items: t.Array(meetingResponse),
  /** Сколько встреч во всей выборке, без учёта курсора, — для счётчика в кабинете. */
  total: t.Number(),
  /** `null` — страница последняя. */
  nextCursor: t.Nullable(t.String()),
})

interface Cursor {
  date: Date
  id: string
}

/**
 * Курсор — последняя встреча страницы, пара (дата, id), а не номер страницы:
 * сдвиг «пропусти N» поехал бы, как только появится новая встреча, а по одной
 * дате одинаковые метки на стыке страниц выпали бы или задвоились. Для клиента
 * строка непрозрачна — он только передаёт её обратно.
 */
const encodeCursor = ({ date, id }: Cursor): string =>
  Buffer.from(`${date.toISOString()}|${id}`).toString('base64url')

/** `null` — курсор не наш: не base64url, не та форма, не дата или не uuid. */
const decodeCursor = (cursor: string): Cursor | null => {
  const [iso, id, ...rest] = Buffer.from(cursor, 'base64url').toString('utf8').split('|')

  if (iso === undefined || id === undefined || rest.length > 0 || !isUuid(id)) {
    return null
  }

  const date = new Date(iso)

  return Number.isNaN(date.getTime()) || date.toISOString() !== iso ? null : { date, id }
}

/** Даты наружу — строго ISO-8601 в UTC, а не то, в каком виде их прислал клиент. */
const toResponse = (meeting: MeetingRow) => ({
  ...meeting,
  date: meeting.date.toISOString(),
  createdAt: meeting.createdAt.toISOString(),
})

/** Тот же нижний регистр, что и у адресов в `users`, плюс снятие дублей. */
const normalizeParticipants = (participants: string[]): string[] => [
  ...new Set(participants.map((participant) => participant.trim().toLowerCase())),
]

const security = [{ bearerAuth: [] }]

/**
 * Встречи одного пользователя. Место под файлы ограничивает квота
 * (`files/limits.ts`), а это — число строк: регистрация открыта, и без потолка
 * скрипт заводил бы встречи без конца. Тысяча — годы ежедневных встреч.
 */
export const MAX_MEETINGS_PER_USER = 1000

export const TOO_MANY_MEETINGS = `Достигнут лимит: у вас уже ${MAX_MEETINGS_PER_USER} встреч`

export const meetingsModule = new Elysia({ prefix: '/meetings', tags: ['Meetings'] })
  .use(authenticated)
  .post(
    '',
    async ({ body, userId, status }) => {
      // Счёт под замком строки пользователя, как квота файлов: в READ
      // COMMITTED `count` ничего не блокирует, и параллельные запросы прошли
      // бы потолок все разом.
      const meeting = await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`

        if ((await tx.meeting.count({ where: { ownerId: userId } })) >= MAX_MEETINGS_PER_USER) {
          return null
        }

        return tx.meeting.create({
          data: {
            title: body.title,
            date: new Date(body.date),
            participants: normalizeParticipants(body.participants),
            ownerId: userId,
          },
          select: publicFields,
        })
      })

      if (!meeting) {
        return status(409, { message: TOO_MANY_MEETINGS })
      }

      return status(201, toResponse(meeting))
    },
    {
      body: meetingInput,
      response: {
        201: meetingResponse,
        401: messageResponse,
        409: messageResponse,
      },
      detail: { summary: 'Create a meeting', security },
    },
  )
  .get(
    '',
    async ({ userId, query, status }) => {
      const after = query.cursor === undefined ? null : decodeCursor(query.cursor)

      if (after === null && query.cursor !== undefined) {
        return status(400, { message: 'Invalid cursor' })
      }

      const limit = query.limit ?? DEFAULT_PAGE_SIZE
      const upcoming = (query.scope ?? 'upcoming') === 'upcoming'
      const now = new Date()

      // Граница — часы сервера, а не клиента: у браузера они могут врать, и
      // встреча попала бы не в ту выборку.
      const inScope = { ownerId: userId, date: upcoming ? { gte: now } : { lt: now } }

      // После курсора — строго дальше по паре (дата, id) в сторону сортировки.
      const afterCursor =
        after === null
          ? {}
          : upcoming
            ? { OR: [{ date: { gt: after.date } }, { date: after.date, id: { gt: after.id } }] }
            : { OR: [{ date: { lt: after.date } }, { date: after.date, id: { lt: after.id } }] }

      const order = upcoming ? 'asc' : 'desc'

      // Один лишний ряд говорит, есть ли следующая страница, без второго счёта.
      const [rows, total] = await Promise.all([
        prisma.meeting.findMany({
          where: { AND: [inScope, afterCursor] },
          orderBy: [{ date: order }, { id: order }],
          take: limit + 1,
          select: publicFields,
        }),
        prisma.meeting.count({ where: inScope }),
      ])

      const items = rows.slice(0, limit)
      const last = items.at(-1)

      return {
        items: items.map(toResponse),
        total,
        nextCursor: rows.length > limit && last ? encodeCursor(last) : null,
      }
    },
    {
      query: listQuery,
      response: {
        200: meetingsPage,
        400: messageResponse,
        401: messageResponse,
      },
      detail: { summary: 'List meetings of the current user, page by page', security },
    },
  )
  .get(
    '/:id',
    async ({ params, userId, status }) => {
      // Фильтр по владельцу в самом запросе: чужая встреча не находится, а не
      // находится и отбраковывается — тогда её существование не подтвердить.
      // Не uuid — до базы не доходит (`isUuid`).
      const meeting = isUuid(params.id)
        ? await prisma.meeting.findFirst({
            where: { id: params.id, ownerId: userId },
            select: publicFields,
          })
        : null

      if (!meeting) {
        return status(404, { message: 'Meeting not found' })
      }

      return toResponse(meeting)
    },
    {
      params: t.Object({ id: t.String() }),
      response: {
        200: meetingResponse,
        401: messageResponse,
        404: messageResponse,
      },
      detail: { summary: 'Get one meeting by id', security },
    },
  )
