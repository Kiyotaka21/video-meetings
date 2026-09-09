<script setup lang="ts">
import type { Meeting } from '~/types/meetings'
import { isUnauthorized } from '~/utils/api'
import { describeMeetingsFailure, RECENT_MEETINGS_LIMIT, splitMeetings } from '~/utils/meetings'

// routeRules '/' -> ssr: false: страница за авторизацией, токен лежит в куке и
// читается в браузере, индексировать здесь нечего.
definePageMeta({ middleware: 'auth' })

useSeoMeta({ title: 'Мои встречи — Video Meetings', robots: 'noindex' })

const { user, fetchUser, logout } = useAuth()
const { fetchMeetings } = useMeetings()
const toast = useToast()

const meetings = shallowRef<Meeting[]>([])
const isLoading = shallowRef(true)
const isLoggingOut = shallowRef(false)
const failure = shallowRef<string | null>(null)

const split = computed(() => splitMeetings(meetings.value))

/**
 * Пользователь и встречи запрашиваются параллельно: маршруты независимые, и
 * последовательный вызов удваивал бы ожидание на пустом месте.
 *
 * `useAsyncData` здесь не нужен: страница клиентская, серверного payload'а для
 * гидратации нет, а кэш и дедупликация одному вызову на монтировании ничего не
 * дают — зато обработку 401 пришлось бы вытаскивать из обёртки ошибки.
 */
const load = async () => {
  isLoading.value = true
  failure.value = null

  try {
    const [, list] = await Promise.all([fetchUser(), fetchMeetings()])

    meetings.value = list
  } catch (error) {
    // Токен в куке есть, middleware пропустил, а api его не принял: истёк,
    // выпущен против другой базы или учётку удалили. Это конец сессии, а не
    // сбой запроса, поэтому выходим, а не предлагаем повторить.
    if (isUnauthorized(error)) {
      toast.add({
        title: 'Сессия истекла',
        description: 'Войдите снова, чтобы увидеть встречи.',
        color: 'warning',
        icon: 'i-lucide-clock-alert',
      })

      await logout()

      return
    }

    failure.value = describeMeetingsFailure(error)
  } finally {
    isLoading.value = false
  }
}

onMounted(load)

const onLogout = async () => {
  isLoggingOut.value = true

  toast.add({
    title: 'Вы вышли',
    description: 'Токен удалён из этого браузера.',
    color: 'success',
    icon: 'i-lucide-circle-check',
  })

  await logout()
}
</script>

<template>
  <div class="flex flex-col gap-8">
    <div class="flex flex-col gap-2">
      <h1 class="text-3xl font-semibold tracking-tight text-highlighted">Мои встречи</h1>
      <p class="text-muted">Расписание, которое видите только вы.</p>
    </div>

    <DashboardAccountCard
      :email="user?.email"
      :pending="isLoading"
      :loading="isLoggingOut"
      @logout="onLogout"
    />

    <UAlert
      v-if="failure"
      role="alert"
      color="error"
      variant="subtle"
      icon="i-lucide-triangle-alert"
      title="Встречи не загрузились"
      :description="failure"
      :actions="[{ label: 'Повторить', color: 'error', variant: 'outline', onClick: () => load() }]"
    />

    <div v-else-if="isLoading" class="flex flex-col gap-4">
      <!-- Одно объявление на весь блок загрузки. Сами `USkeleton` уходят под
           `aria-hidden`: каждый из них рендерит `role="alert"` с `aria-live` и
           `aria-label="loading"`, и восемь заглушек давали восемь конкурирующих
           живых регионов с чужим английским словом вместо одного сообщения. -->
      <span role="status" class="sr-only">Загружаем ваши встречи</span>

      <!-- Геометрия повторяет строку встречи: список не должен подпрыгивать,
           когда придут настоящие данные. -->
      <div aria-hidden="true" class="flex flex-col gap-4">
        <div class="flex items-center gap-3">
          <USkeleton class="size-5 shrink-0 rounded-full" />
          <USkeleton class="h-6 w-52" />
        </div>

        <UCard :ui="{ body: 'py-0 sm:py-0' }">
          <ul class="divide-y divide-default">
            <li
              v-for="row in RECENT_MEETINGS_LIMIT"
              :key="row"
              class="flex flex-col gap-3 py-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6"
            >
              <div class="flex flex-col gap-2">
                <USkeleton class="h-5 w-44 sm:w-64" />
                <USkeleton class="h-4 w-36 sm:w-48" />
              </div>
              <USkeleton class="h-6 w-28 sm:w-40" />
            </li>
          </ul>
        </UCard>
      </div>
    </div>

    <template v-else>
      <MeetingsSection
        title="Предстоящие встречи"
        icon="i-lucide-calendar-clock"
        :meetings="split.upcoming"
        empty="Предстоящих встреч пока нет — назначенная встреча появится здесь."
      />

      <!-- Без блока `empty`: у прошедших встреч пустота — не новость, о которой
           надо сообщать, поэтому секция просто не рисуется. -->
      <MeetingsSection title="Последние встречи" icon="i-lucide-history" :meetings="split.recent" />
    </template>
  </div>
</template>
