import type { Meeting } from '~/types/meetings'

/**
 * Запросы к `/meetings`. Пока только чтение — создание встреч на фронтенде ещё
 * не заведено, хотя `POST /meetings` на api есть.
 */
export const useMeetings = () => {
  const { authHeaders } = useAuth()
  const { apiUrl } = useRuntimeConfig().public

  /**
   * Отдаёт встречи текущего пользователя по возрастанию даты — так их
   * сортирует api. Отказ не глотает: 401 вызывающий обрабатывает как конец
   * сессии, остальное раскладывает `describeMeetingsFailure`.
   */
  const fetchMeetings = (): Promise<Meeting[]> =>
    $fetch<Meeting[]>('/meetings', {
      baseURL: apiUrl,
      headers: authHeaders(),
    })

  return { fetchMeetings }
}
