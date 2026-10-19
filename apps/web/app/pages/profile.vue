<script setup lang="ts">
import { isUnauthorized } from '~/utils/api'
import { describeProfileFailure } from '~/utils/profile'

// routeRules '/profile' -> ssr: false: страница за авторизацией, токен лежит в
// куке и читается в браузере, индексировать здесь нечего.
definePageMeta({ middleware: 'auth' })

useSeoMeta({ title: 'Профиль — Video Meetings', robots: 'noindex' })

const { user, fetchUser, logout } = useAuth()
const toast = useToast()

const isLoading = shallowRef(true)
const failure = shallowRef<string | null>(null)

/**
 * Токен в куке есть, middleware пропустил, а api его не принял: истёк, выпущен
 * против другой базы или учётку удалили. Это конец сессии, а не сбой запроса, —
 * та же ветка, что и в кабинете и на странице встречи.
 */
const endSession = async () => {
  toast.add({
    title: 'Сессия истекла',
    description: 'Войдите снова, чтобы открыть профиль.',
    color: 'warning',
    icon: 'i-lucide-clock-alert',
  })

  await logout()
}

/**
 * Пользователь запрашивается заново, даже если пришёл с `/` и уже лежит в общем
 * `user`: профиль — то место, где данные правят, и показывать здесь снимок
 * минутной давности (имя могли сменить в соседней вкладке) хуже, чем один
 * лишний запрос.
 */
const load = async () => {
  isLoading.value = true
  failure.value = null

  try {
    await fetchUser()
  } catch (error) {
    if (isUnauthorized(error)) {
      await endSession()

      return
    }

    failure.value = describeProfileFailure(error)
  } finally {
    isLoading.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="flex flex-col gap-8">
    <div class="flex flex-col gap-2">
      <h1 class="text-3xl font-semibold tracking-tight text-highlighted">Профиль</h1>
      <p class="text-muted">Как вас видно в кабинете.</p>
    </div>

    <UAlert
      v-if="failure"
      role="alert"
      color="error"
      variant="subtle"
      icon="i-lucide-triangle-alert"
      title="Профиль не загрузился"
      :description="failure"
      :actions="[{ label: 'Повторить', color: 'error', variant: 'outline', onClick: () => load() }]"
    />

    <section v-else class="flex flex-col gap-4">
      <div class="flex items-center gap-3">
        <UIcon name="i-lucide-id-card" class="size-5 shrink-0 text-primary" />
        <h2 class="text-xl font-semibold tracking-tight text-highlighted">Имя</h2>
      </div>

      <UCard>
        <!-- Одно объявление о загрузке; сами `USkeleton` уходят под
             `aria-hidden`: каждый рендерит свой `role="alert"` с английским
             «loading». -->
        <template v-if="isLoading">
          <span role="status" class="sr-only">Загружаем профиль</span>
          <div aria-hidden="true">
            <USkeleton class="h-6 w-64 max-w-full" />
          </div>
        </template>

        <p v-else-if="user?.name" class="wrap-anywhere text-highlighted">{{ user.name }}</p>

        <p v-else-if="user" class="text-muted">
          Имя не задано — в кабинете виден адрес
          <span class="break-all text-highlighted">{{ user.email }}</span>
        </p>
      </UCard>
    </section>
  </div>
</template>
