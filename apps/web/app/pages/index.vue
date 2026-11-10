<script setup lang="ts">
import type { Meeting } from '~/types/meetings'
import { isUnauthorized } from '~/utils/api'
import {
  describeMeetingsFailure,
  describeMoreMeetingsFailure,
  RECENT_MEETINGS_LIMIT,
  UPCOMING_PAGE_SIZE,
} from '~/utils/meetings'

// routeRules '/' -> ssr: false: страница за авторизацией, токен лежит в куке и
// читается в браузере, индексировать здесь нечего.
definePageMeta({ middleware: 'auth' })

useSeoMeta({ title: 'Мои встречи — Video Meetings', robots: 'noindex' })

const { user, fetchUser, logout, currentToken, handleUnauthorized } = useAuth()
const { fetchMeetingsPage } = useMeetings()
const toast = useToast()

/** Предстоящие копятся страницами: «Показать ещё» дописывает следующую в конец. */
const upcoming = shallowRef<Meeting[]>([])
const upcomingTotal = shallowRef(0)
const upcomingCursor = shallowRef<string | null>(null)
/** Последние прошедшие — одна страница из `RECENT_MEETINGS_LIMIT` штук, без догрузки. */
const recent = shallowRef<Meeting[]>([])

const isLoading = shallowRef(true)
const isLoggingOut = shallowRef(false)
const failure = shallowRef<string | null>(null)
const isLoadingMore = shallowRef(false)
const moreFailure = shallowRef<string | null>(null)

/**
 * Пользователь и обе выборки встреч запрашиваются параллельно: маршруты
 * независимые, и последовательный вызов умножал бы ожидание на пустом месте.
 * На предстоящие и прошедшие делит api, по своим часам, — два запроса вместо
 * одного списка, который пришлось бы тянуть целиком ради трёх прошедших.
 *
 * `useAsyncData` здесь не нужен: страница клиентская, серверного payload'а для
 * гидратации нет, а кэш и дедупликация одному вызову на монтировании ничего не
 * дают — зато обработку 401 пришлось бы вытаскивать из обёртки ошибки.
 */
const load = async () => {
  isLoading.value = true
  failure.value = null
  moreFailure.value = null

  const sentToken = currentToken()

  try {
    const [, upcomingPage, recentPage] = await Promise.all([
      fetchUser(),
      fetchMeetingsPage('upcoming', { limit: UPCOMING_PAGE_SIZE }),
      fetchMeetingsPage('past', { limit: RECENT_MEETINGS_LIMIT }),
    ])

    upcoming.value = upcomingPage.items
    upcomingTotal.value = upcomingPage.total
    upcomingCursor.value = upcomingPage.nextCursor
    recent.value = recentPage.items
  } catch (error) {
    // Токен в куке есть, middleware пропустил, а api его не принял. Это конец
    // сессии, а не сбой запроса, — если только соседняя вкладка не положила в
    // куку новый токен: тогда загрузка повторяется с ним.
    if (isUnauthorized(error)) {
      await handleUnauthorized(sentToken, {
        retry: load,
        description: 'Войдите снова, чтобы увидеть встречи.',
      })

      return
    }

    failure.value = describeMeetingsFailure(error)
  } finally {
    isLoading.value = false
  }
}

onMounted(load)

/**
 * Следующая страница предстоящих. Отказ не трогает `failure` страницы: уже
 * показанные встречи остаются на месте, а текст отказа встаёт под кнопкой,
 * которой же догрузку и повторяют. 401 — тот же конец сессии, что и на загрузке.
 *
 * Флага «уже грузится» нет намеренно: на время запроса кнопка выключена
 * (`loading`), а повтор из `handleUnauthorized` вызывает функцию изнутри
 * текущего вызова и с флагом сразу бы вышел.
 */
const loadMore = async () => {
  const cursor = upcomingCursor.value

  if (!cursor) {
    return
  }

  isLoadingMore.value = true
  moreFailure.value = null

  const sentToken = currentToken()

  try {
    const page = await fetchMeetingsPage('upcoming', { limit: UPCOMING_PAGE_SIZE, cursor })

    // Курсор по `(date, id)` дублей не даёт, пока дата встречи не меняется
    // между запросами страниц. Правки встреч ещё нет, но с ней перенесённая
    // встреча пришла бы второй раз, а две строки с одним `key` ломают список.
    const known = new Set(upcoming.value.map((meeting) => meeting.id))

    upcoming.value = [...upcoming.value, ...page.items.filter((meeting) => !known.has(meeting.id))]
    upcomingTotal.value = page.total
    upcomingCursor.value = page.nextCursor
  } catch (error) {
    if (isUnauthorized(error)) {
      await handleUnauthorized(sentToken, {
        retry: loadMore,
        description: 'Войдите снова, чтобы увидеть встречи.',
      })

      return
    }

    moreFailure.value = describeMoreMeetingsFailure(error)
  } finally {
    isLoadingMore.value = false
  }
}

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
      :name="user?.name"
      :avatar-url="user?.avatarUrl"
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
        :meetings="upcoming"
        :total="upcomingTotal"
        :has-more="upcomingCursor !== null"
        :loading-more="isLoadingMore"
        :more-failure="moreFailure"
        empty="Предстоящих встреч пока нет — назначенная встреча появится здесь."
        @more="loadMore"
      />

      <!-- Без блока `empty`: у прошедших встреч пустота — не новость, о которой
           надо сообщать, поэтому секция просто не рисуется. И без `total`:
           блок показывает несколько свежих, а не архив, и «57 встреч» над тремя
           строками без «Показать ещё» читалось бы как обрезанный список. -->
      <MeetingsSection title="Последние встречи" icon="i-lucide-history" :meetings="recent" />
    </template>
  </div>
</template>
