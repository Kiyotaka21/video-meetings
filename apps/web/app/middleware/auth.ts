/**
 * Guard для страниц за авторизацией. Подключается точечно —
 * `definePageMeta({ middleware: 'auth' })`, а не глобально: публичных страниц
 * в приложении больше, чем приватных.
 *
 * Проверяет только наличие токена. Годность подтверждает api, и это не
 * упущение: разобрать `exp` на клиенте можно, но подпись без секрета всё равно
 * не проверить, так что настоящий рубеж — 401 от api. Страница обрабатывает его
 * как конец сессии (`isUnauthorized` в `utils/api.ts`).
 */
export default defineNuxtRouteMiddleware(() => {
  const { isAuthenticated } = useAuth()

  if (!isAuthenticated.value) {
    return navigateTo('/login')
  }
})
