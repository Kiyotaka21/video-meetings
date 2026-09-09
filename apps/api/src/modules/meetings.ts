import { Elysia, t } from 'elysia'

import { prisma } from '../db/prisma'
import { authenticated } from './auth'

const meetingInput = t.Object({
  title: t.String({ minLength: 1, maxLength: 200 }),
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

export const meetingsModule = new Elysia({ prefix: '/meetings', tags: ['Meetings'] })
  .use(authenticated)
  .post(
    '',
    async ({ body, userId, status }) => {
      const meeting = await prisma.meeting.create({
        data: {
          title: body.title,
          date: new Date(body.date),
          participants: normalizeParticipants(body.participants),
          ownerId: userId,
        },
        select: publicFields,
      })

      return status(201, toResponse(meeting))
    },
    {
      body: meetingInput,
      response: {
        201: meetingResponse,
        401: messageResponse,
      },
      detail: { summary: 'Create a meeting', security },
    },
  )
  .get(
    '',
    async ({ userId }) => {
      const meetings = await prisma.meeting.findMany({
        where: { ownerId: userId },
        orderBy: { date: 'asc' },
        select: publicFields,
      })

      return meetings.map(toResponse)
    },
    {
      response: {
        200: t.Array(meetingResponse),
        401: messageResponse,
      },
      detail: { summary: 'List meetings of the current user', security },
    },
  )
  .get(
    '/:id',
    async ({ params, userId, status }) => {
      // Фильтр по владельцу в самом запросе: чужая встреча не находится, а не
      // находится и отбраковывается — тогда её существование не подтвердить.
      const meeting = await prisma.meeting.findFirst({
        where: { id: params.id, ownerId: userId },
        select: publicFields,
      })

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
