import type { Credentials, TokenResponse } from '~/types/auth'

/**
 * Токен лежит в куке, а не в `localStorage`: `useCookie` читается и на сервере,
 * поэтому будущий route middleware сможет отбить неавторизованного до рендера,
 * не дожидаясь гидратации.
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

  const { apiUrl } = useRuntimeConfig().public
  const isAuthenticated = computed(() => Boolean(token.value))

  /**
   * Ошибку не глотает: вызывающий раскладывает её через `describeRegisterFailure`,
   * потому что текст для пользователя зависит от того, где стоит форма.
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

  return { token: readonly(token), isAuthenticated, register }
}
