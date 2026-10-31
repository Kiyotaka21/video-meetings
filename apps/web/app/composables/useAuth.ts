import type { AuthUser, Credentials, PasswordChange, TokenResponse } from '~/types/auth'

/**
 * Токен лежит в куке, а не в `localStorage`: `useCookie` читается и на сервере,
 * поэтому route middleware отбивает неавторизованного до рендера страницы, не
 * дожидаясь гидратации.
 */
const TOKEN_COOKIE = 'auth_token'

/** Столько же, сколько живёт JWT на api (`JWT_EXPIRES_IN`, по умолчанию 7d). */
const TOKEN_MAX_AGE_SECONDS = 60 * 60 * 24 * 7

/**
 * Токен из `document.cookie` — как он лежит в куке прямо сейчас. Кодирование то
 * же, что у `useCookie`: JWT состоит из URL-безопасных символов, и
 * `encodeURIComponent` его не меняет; битую последовательность `%` отдаём как
 * есть, а не роняем запрос.
 */
const readTokenCookie = (): string | null => {
  const prefix = `${TOKEN_COOKIE}=`
  const pair = document.cookie.split('; ').find((item) => item.startsWith(prefix))

  if (!pair) {
    return null
  }

  const raw = pair.slice(prefix.length)

  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

/** Что делать на 401 вместо выхода, если сессия на самом деле жива. */
interface UnauthorizedOptions {
  /** Повторить то, что упало: загрузку страницы или действие пользователя. */
  retry: () => Promise<unknown>
  /** Пояснение к тосту «Сессия истекла» — своё у каждой страницы. */
  description: string
}

export const useAuth = () => {
  const token = useCookie<string | null>(TOKEN_COOKIE, {
    maxAge: TOKEN_MAX_AGE_SECONDS,
    sameSite: 'lax',
    // На localhost по http кука с `secure` не поставится, в проде — только по https.
    secure: !import.meta.dev,
    path: '/',
  })

  /**
   * Пользователь — общее состояние приложения, а не локальное для вызова
   * композабла: `useState` отдаёт всем один и тот же объект, поэтому шапка,
   * страница и любой будущий компонент не делают по запросу `/auth/me` каждый.
   */
  const user = useState<AuthUser | null>('auth:user', () => null)

  const { apiUrl } = useRuntimeConfig().public
  const toast = useToast()
  const isAuthenticated = computed(() => Boolean(token.value))

  /**
   * Токен, с которым уйдёт запрос, — из куки, а не из ref'а `useCookie`. Ref у
   * каждого вызова `useAuth()` свой (страница, `useMeetings`,
   * `useMeetingFiles`), и запись в куку из соседней вкладки он догоняет
   * событием `cookieStore` — не мгновенно, а без `cookieStore` в браузере и
   * вовсе только через `BroadcastChannel`. Кука же общая и всегда свежая:
   * вкладка, открытая до смены пароля, шлёт уже новый токен.
   *
   * Запись идёт по-прежнему через ref: в `document.cookie` её кладёт watcher
   * `useCookie` до ближайшей перерисовки, задолго до следующего запроса.
   */
  const currentToken = (): string | null =>
    import.meta.client ? readTokenCookie() : (token.value ?? null)

  /**
   * Заголовок для закрытых маршрутов api. Живёт здесь, а не в вызывающем
   * композабле, чтобы формат `Bearer` и имя куки не разъезжались по файлам.
   */
  const authHeaders = (): Record<string, string> => ({
    authorization: `Bearer ${currentToken()}`,
  })

  /**
   * Ошибки не глотает: вызывающий раскладывает их через `describeRegisterFailure`
   * или `describeLoginFailure` — текст для пользователя зависит от экрана.
   */
  const register = async (credentials: Credentials): Promise<void> => {
    const { token: issued } = await $fetch<TokenResponse>('/auth/register', {
      baseURL: apiUrl,
      method: 'POST',
      // Адрес api приводит к нижнему регистру сам, пробелы по краям срезаем здесь.
      body: { email: credentials.email.trim(), password: credentials.password },
    })

    token.value = issued
  }

  const login = async (credentials: Credentials): Promise<void> => {
    const { token: issued } = await $fetch<TokenResponse>('/auth/login', {
      baseURL: apiUrl,
      method: 'POST',
      body: { email: credentials.email.trim(), password: credentials.password },
    })

    token.value = issued
  }

  /**
   * Пользователь берётся у api, а не из payload'а токена: подпись на клиенте не
   * проверить, а токен — снимок на момент выпуска, без имени и аватара, и их
   * правка до него не доезжает.
   */
  const fetchUser = async (): Promise<AuthUser> => {
    const account = await $fetch<AuthUser>('/auth/me', {
      baseURL: apiUrl,
      headers: authHeaders(),
    })

    user.value = account

    return account
  }

  /**
   * `PATCH /auth/me` отвечает тем же объектом, что и `GET`, поэтому ответ сразу
   * ложится в общий `user` — карточка на `/` покажет новое имя без повторного
   * запроса. Строка уходит как набрана: обрезку пробелов и сброс пустого в
   * `null` делает api, и в `user` попадает уже его результат.
   */
  const updateName = async (name: string): Promise<AuthUser> => {
    const account = await $fetch<AuthUser>('/auth/me', {
      baseURL: apiUrl,
      method: 'PATCH',
      headers: authHeaders(),
      body: { name },
    })

    user.value = account

    return account
  }

  /**
   * Тело — сам файл, а не `FormData`: api читает сырое тело (`parse: 'none'`)
   * и сливает на диск потоком, а multipart разобрал бы в память ещё до
   * обработчика. Ofetch `Blob` не сериализует (он не «простой объект»), и
   * `Content-Type` из `image.type` ставит сам `fetch`; пустой тип — без
   * заголовка, api его всё равно не читает: формат он узнаёт по первым байтам.
   *
   * `$fetch`, а не `XMLHttpRequest`, как у файлов встречи: прогресс для 2 МБ не
   * нужен, и PRD его не требует. Ответ — тот же объект, что у `GET /auth/me`, и
   * сразу ложится в общий `user`: карточка на `/` покажет новый аватар без
   * повторного запроса.
   */
  const uploadAvatar = async (image: Blob): Promise<AuthUser> => {
    const account = await $fetch<AuthUser>('/auth/me/avatar', {
      baseURL: apiUrl,
      method: 'PUT',
      headers: authHeaders(),
      body: image,
    })

    user.value = account

    return account
  }

  /** Ответ — пользователь с `avatarUrl: null`, и он тоже сразу ложится в `user`. */
  const deleteAvatar = async (): Promise<AuthUser> => {
    const account = await $fetch<AuthUser>('/auth/me/avatar', {
      baseURL: apiUrl,
      method: 'DELETE',
      headers: authHeaders(),
    })

    user.value = account

    return account
  }

  /**
   * Смена пароля отзывает на api все токены пользователя, выпущенные раньше, —
   * и тот, с которым ушёл этот запрос. Поэтому токен из ответа сразу ложится в
   * куку с тем же `maxAge`, что при входе: без этого вкладка, сменившая пароль,
   * вышла бы из системы вместе со всеми, а соседние вкладки этого браузера
   * подхватят новый токен из общей куки.
   *
   * Ошибки не глотает: 403 и 400 вызывающий раскладывает через
   * `describePasswordChangeFailure`, 401 — конец сессии.
   */
  const changePassword = async (change: PasswordChange): Promise<void> => {
    const { token: issued } = await $fetch<TokenResponse>('/auth/me/password', {
      baseURL: apiUrl,
      method: 'POST',
      headers: authHeaders(),
      body: change,
    })

    token.value = issued
  }

  /** Локальный выход: серверной сессии нет, JWT доживает свой `exp` сам. */
  const logout = async (): Promise<void> => {
    token.value = null
    user.value = null

    await navigateTo('/login')
  }

  /**
   * 401 от api — одна ветка на все страницы за авторизацией: `/`,
   * `/meetings/[id]` и `/profile`. `sentToken` — `currentToken()`, снятый перед
   * запросом: с ним запрос и ушёл.
   *
   * Перед выходом кука перечитывается. Если в ней уже другой токен, её обновила
   * соседняя вкладка — сменила пароль или вошла заново, — и сессия жива: 401
   * получил запрос, ушедший со старым токеном. Выход здесь стёр бы из куки
   * новый токен и выкинул бы из системы обе вкладки. Вместо него — повтор:
   * `authHeaders()` возьмёт токен уже из обновлённой куки. Повтор не
   * зацикливается: его 401 придёт с тем токеном, что лежит в куке, и кончится
   * выходом.
   *
   * Тот же токен или кука пуста — сессия мертва: тост и `logout()`, а не «нет
   * связи», иначе истёкший токен держал бы пользователя в тупике.
   */
  const handleUnauthorized = async (
    sentToken: string | null,
    { retry, description }: UnauthorizedOptions,
  ): Promise<void> => {
    const fresh = currentToken()

    if (fresh && fresh !== sentToken) {
      await retry()

      return
    }

    toast.add({
      title: 'Сессия истекла',
      description,
      color: 'warning',
      icon: 'i-lucide-clock-alert',
    })

    await logout()
  }

  return {
    token: readonly(token),
    user,
    isAuthenticated,
    currentToken,
    authHeaders,
    register,
    login,
    fetchUser,
    updateName,
    uploadAvatar,
    deleteAvatar,
    changePassword,
    logout,
    handleUnauthorized,
  }
}
