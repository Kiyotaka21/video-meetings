import type { Meeting, MeetingScope, MeetingsPage } from '~/types/meetings'

export interface MeetingsPageQuery {
  limit: number
  /** `nextCursor` прошлой страницы как есть; без него — первая страница. */
  cursor?: string | null
}

/**
 * Запросы к `/meetings`. Пока только чтение — создание встреч на фронтенде ещё
 * не заведено, хотя `POST /meetings` на api есть.
 */
export const useMeetings = () => {
  const { authHeaders } = useAuth()
  const { apiUrl } = useRuntimeConfig().public

  /**
   * Страница встреч текущего пользователя из одной выборки. Порядок и границу
   * «прошла или нет» задаёт api — клиент ничего не досортировывает и не делит
   * по своим часам. Отказ не глотает: 401 вызывающий обрабатывает как конец
   * сессии, остальное раскладывает `describeMeetingsFailure`.
   */
  const fetchMeetingsPage = (
    scope: MeetingScope,
    { limit, cursor }: MeetingsPageQuery,
  ): Promise<MeetingsPage> =>
    $fetch<MeetingsPage>('/meetings', {
      baseURL: apiUrl,
      headers: authHeaders(),
      query: cursor ? { scope, limit, cursor } : { scope, limit },
    })

  /**
   * Одна встреча. Чужая отвечает тем же 404, что и несуществующая, — api
   * намеренно не подтверждает, что такая встреча вообще есть.
   */
  const fetchMeeting = (id: string): Promise<Meeting> =>
    $fetch<Meeting>(`/meetings/${id}`, {
      baseURL: apiUrl,
      headers: authHeaders(),
    })

  return { fetchMeetingsPage, fetchMeeting }
}
