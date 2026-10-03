/**
 * Через сколько ссылки на файлы считаются устаревшими. Токен в ссылке живёт 15
 * минут (`FILE_LINK_EXPIRES_IN` на api); пять минут запаса — чтобы «Скачать»
 * не открыло вкладку с JSON 401 вместо файла.
 */
const STALE_AFTER_MS = 10 * 60 * 1000

/** Как часто проверять возраст ссылок, пока вкладка открыта. */
const CHECK_EVERY_MS = 60 * 1000

/**
 * Держит ссылки на файлы свежими: по таймеру и при возврате на вкладку
 * перезапрашивает список, если ссылкам больше 10 минут. Плеер так не
 * спасти — запись, открытая 20 минут назад, лечится своей ошибкой и
 * перезапросом (`FileItem`), — а вот ссылку «Скачать» спасает: она обычная
 * `<a href>`, и протухшая отправила бы пользователя на голый ответ api.
 *
 * Таймер браузер усыпляет вместе с вкладкой и ноутбуком; `visibilitychange`
 * покрывает возвращение.
 */
export const useFreshLinks = (refresh: () => Promise<void>) => {
  let issuedAt = Date.now()
  let timer: ReturnType<typeof setInterval> | undefined

  /** Ссылки только что пришли с api — отсчёт заново. */
  const markFresh = () => {
    issuedAt = Date.now()
  }

  const refreshIfStale = () => {
    if (document.visibilityState === 'visible' && Date.now() - issuedAt > STALE_AFTER_MS) {
      void refresh()
    }
  }

  onMounted(() => {
    timer = setInterval(refreshIfStale, CHECK_EVERY_MS)
    document.addEventListener('visibilitychange', refreshIfStale)
  })

  onBeforeUnmount(() => {
    clearInterval(timer)
    document.removeEventListener('visibilitychange', refreshIfStale)
  })

  return { markFresh }
}
