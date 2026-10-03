import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { expect } from 'bun:test'

import { TEST_UPLOAD_DIR } from '../setup'
import { postJson, type ApiResponse } from './http'

/**
 * Общее для тестов файлов встречи: загрузки, отдачи и удаления. Контракт
 * полей ответа зафиксирован здесь одним списком — и `POST`, и `GET` обязаны
 * отдавать ровно его.
 */

const FILE_FIELDS = ['createdAt', 'id', 'kind', 'mimeType', 'name', 'size', 'status', 'url']

export interface MeetingFile {
  id: string
  name: string
  size: number
  mimeType: string
  kind: string
  status: string
  createdAt: string
  /** Путь отдачи от корня api с файловым токеном в `?token=`. */
  url: string
}

export const asFile = (body: unknown): MeetingFile => {
  expect(Object.keys(body as object).sort()).toEqual(FILE_FIELDS)

  return body as MeetingFile
}

export const asFiles = (body: unknown): MeetingFile[] => {
  expect(Array.isArray(body)).toBe(true)

  return body as MeetingFile[]
}

export const filesPath = (meetingId: string): string => `/meetings/${meetingId}/files`

/** Встреча нужна почти каждому тесту, а её собственный контракт проверяет соседний файл. */
export const createMeeting = async (token: string): Promise<string> => {
  const response = await postJson(
    '/meetings',
    { title: 'Встреча с файлами', date: '2026-03-01T10:00:00.000Z', participants: [] },
    token,
  )

  expect(response.status).toBe(201)

  return (response.body as { id: string }).id
}

/** Каталог встречи на диске: путь целиком генерирует api, клиент его не видит. */
export const meetingDir = (meetingId: string): string => join(TEST_UPLOAD_DIR, meetingId)

/**
 * Что лежит в каталоге встречи. Каталога нет — пустой список: отказ до записи
 * его не создаёт, отказ посреди записи оставляет пустым, и для теста оба случая
 * значат одно — на диске после отказа ничего не осталось.
 */
export const storedFiles = (meetingId: string): string[] =>
  existsSync(meetingDir(meetingId)) ? readdirSync(meetingDir(meetingId)).sort() : []

export const messageOf = (response: ApiResponse): string => {
  const { message } = response.body as { message: unknown }

  expect(typeof message).toBe('string')

  return message as string
}
