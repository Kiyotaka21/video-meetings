import type { MeetingFile } from '~/types/files'

/**
 * Запросы к `/meetings/:id/files`. Отдача и удаление файлов — следующие фазы,
 * их на api ещё нет (см. `docs/plan-meeting-file-upload.md`).
 */
export const useMeetingFiles = () => {
  const { authHeaders } = useAuth()
  const { apiUrl } = useRuntimeConfig().public

  /**
   * Файлы встречи по дате загрузки — так их сортирует api. Отказ не глотает:
   * 401 вызывающий обрабатывает как конец сессии, 404 — как «встречи нет».
   */
  const fetchFiles = (meetingId: string): Promise<MeetingFile[]> =>
    $fetch<MeetingFile[]>(`/meetings/${meetingId}/files`, {
      baseURL: apiUrl,
      headers: authHeaders(),
    })

  /**
   * Тело запроса — сам файл, без `multipart`: api не парсит тело и сливает его
   * на диск потоком, поэтому имя уезжает заголовком.
   *
   * `encodeURIComponent` обязателен с обеих сторон: значение HTTP-заголовка —
   * это байты Latin-1, и кириллическое имя браузер в него просто не пустит
   * («String contains non ISO-8859-1 code point»). Api разбирает его обратно.
   *
   * Прогресса здесь нет намеренно: `$fetch` не сообщает о переданных байтах,
   * и процент показать нечем. Он появится вместе с `XMLHttpRequest` в фазе 5.
   */
  const uploadFile = (meetingId: string, file: File): Promise<MeetingFile> =>
    $fetch<MeetingFile>(`/meetings/${meetingId}/files`, {
      baseURL: apiUrl,
      method: 'POST',
      headers: {
        ...authHeaders(),
        'x-file-name': encodeURIComponent(file.name),
        // Браузер оставляет тип пустым для форматов, которых нет в реестре ОС, —
        // на Windows это обычное дело для `.m4a` и `.webm`.
        'content-type': file.type || 'application/octet-stream',
      },
      body: file,
    })

  return { fetchFiles, uploadFile }
}
