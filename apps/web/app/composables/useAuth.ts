import type { AuthUser, Credentials, PasswordChange, TokenResponse } from '~/types/auth'

/**
 * Токен лежит в куке, а не в `localStorage`: `useCookie` читается и на сервере,
 * поэтому route middleware отбивает неавторизованного до рендера страницы, не
 * дожидаясь гидратации.
 */
const TOKEN_COOKIE = 'auth_token'

/** Столько же, сколько живёт JWT на api (`JWT_EXPIRES_IN`, по умолчанию 7d). */
const TOKEN_MAX_AGE_SECONDS = 60 * 60 * 24 * 7

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
  const isAuthenticated = computed(() => Boolean(token.value))

  /**
   * Заголовок для закрытых маршрутов api. Живёт здесь, а не в вызывающем
   * композабле, чтобы формат `Bearer` и имя куки не разъезжались по файлам.
   */
  const authHeaders = (): Record<string, string> => ({ authorization: `Bearer ${token.value}` })

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
   * Адрес берётся у api, а не из payload'а токена: декодировать JWT на клиенте
   * означало бы завязаться на форму payload'а, которую ничто не фиксирует
   * контрактом, — и показывать адрес, не проверив подпись.
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

  return {
    token: readonly(token),
    user,
    isAuthenticated,
    authHeaders,
    register,
    login,
    fetchUser,
    updateName,
    changePassword,
    logout,
  }
}
