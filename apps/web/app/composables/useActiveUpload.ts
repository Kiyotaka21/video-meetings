import type { MeetingFile } from '~/types/files'

/**
 * Что показывает строка текущей загрузки. `saving` — тело ушло целиком, а api
 * ещё дописывает его на диск: для 2 ГБ это заметное время после 100 %.
 */
export interface ActiveUpload {
  name: string
  size: number
  /** Целые проценты отправленных байт, 0..100. */
  percent: number
  phase: 'sending' | 'saving'
}

/**
 * Одна загрузка за раз: очереди в этой итерации нет (решение плана), поэтому
 * состояние — одно значение, а не список.
 *
 * Состояние заменяется целиком (`shallowRef`), а не мутируется по полям:
 * прогресс приходит десятками событий в секунду, и глубокая реактивность тут
 * не нужна.
 */
export const useActiveUpload = () => {
  const { uploadFile } = useMeetingFiles()

  const upload = shallowRef<ActiveUpload | null>(null)
  let abort: (() => void) | null = null

  /**
   * Резолвится метаданными загруженного файла или `null`, если пользователь
   * отменил загрузку. Отказ api и обрыв сети пробрасываются как есть —
   * разбирает их вызывающий (`describeUploadFailure`, 401 → конец сессии).
   */
  const start = async (meetingId: string, file: File): Promise<MeetingFile | null> => {
    upload.value = { name: file.name, size: file.size, percent: 0, phase: 'sending' }

    const handle = uploadFile(meetingId, file, {
      onProgress: (fraction) => {
        if (upload.value?.phase === 'sending') {
          upload.value = { ...upload.value, percent: Math.floor(fraction * 100) }
        }
      },
      onSent: () => {
        if (upload.value) {
          upload.value = { ...upload.value, percent: 100, phase: 'saving' }
        }
      },
    })

    abort = handle.abort

    try {
      return await handle.done
    } catch (error) {
      if (error instanceof UploadAbortedError) {
        return null
      }

      throw error
    } finally {
      upload.value = null
      abort = null
    }
  }

  /** Отмена доходит до api: соединение рвётся, и недописанный файл удаляется там. */
  const cancel = () => abort?.()

  return { upload: readonly(upload), start, cancel }
}
