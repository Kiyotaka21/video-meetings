<script setup lang="ts">
import type { PasswordChange, PasswordChangeFailure } from '~/types/auth'
import { isUnauthorized } from '~/utils/api'
import { describePasswordChangeFailure } from '~/utils/auth'
import { describeNameFailure, describeProfileFailure } from '~/utils/profile'

// routeRules '/profile' -> ssr: false: страница за авторизацией, токен лежит в
// куке и читается в браузере, индексировать здесь нечего.
definePageMeta({ middleware: 'auth' })

useSeoMeta({ title: 'Профиль — Video Meetings', robots: 'noindex' })

const { user, fetchUser, updateName, changePassword, logout } = useAuth()
const toast = useToast()

const isLoading = shallowRef(true)
const failure = shallowRef<string | null>(null)
const isSavingName = shallowRef(false)
const nameFailure = shallowRef<string | null>(null)
const isChangingPassword = shallowRef(false)
const passwordFailure = shallowRef<PasswordChangeFailure | null>(null)

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

/**
 * Любой отказ, кроме 401, уходит текстом под поле, а не в алерт над формой:
 * поле в блоке одно, так что «не сохранилось» — всегда про него, а готовая
 * строка `help` под ним не даёт тексту сдвинуть вёрстку.
 */
const onSaveName = async (name: string) => {
  isSavingName.value = true
  nameFailure.value = null

  try {
    const saved = await updateName(name)

    // Самого имени в тосте нет: что сохранилось, показывает поле, а 50 букв
    // без пробела вылезали из тоста на 360px (замер).
    toast.add({
      title: saved.name ? 'Имя сохранено' : 'Имя сброшено',
      description: saved.name
        ? 'В кабинете оно видно над адресом почты.'
        : 'В кабинете снова виден адрес почты.',
      color: 'success',
      icon: 'i-lucide-circle-check',
    })
  } catch (error) {
    if (isUnauthorized(error)) {
      await endSession()

      return
    }

    nameFailure.value = describeNameFailure(error)
  } finally {
    isSavingName.value = false
  }
}

/**
 * Пока запрос в полёте, повторная отправка не уходит — ни кликом, ни Enter'ом.
 * Выключенные поля и кнопка этого не гарантируют: `UForm` валидирует
 * асинхронно, и два `submit` подряд успевают пройти проверку раньше, чем
 * перерисовка их выключит. А на api две одновременные смены проходят обе, и
 * токен первой отзывает вторая: пришёл её ответ последним — в куке остался бы
 * мёртвый токен, и вкладка вылетела бы на следующем же запросе. Флаг ставится
 * до первого `await`, поэтому второй вызов видит его всегда.
 *
 * 403 и 400 — под своим полем, остальное про запрос целиком — тостом: в форме
 * из трёх полей ему нет своего места, а тост не сдвигает вёрстку.
 */
const onChangePassword = async (change: PasswordChange) => {
  if (isChangingPassword.value) {
    return
  }

  isChangingPassword.value = true
  passwordFailure.value = null

  try {
    await changePassword(change)

    toast.add({
      title: 'Пароль изменён',
      description: 'На других устройствах нужно войти заново.',
      color: 'success',
      icon: 'i-lucide-circle-check',
    })
  } catch (error) {
    if (isUnauthorized(error)) {
      await endSession()

      return
    }

    const refusal = describePasswordChangeFailure(error)

    passwordFailure.value = refusal

    if (!refusal.field) {
      toast.add({
        title: 'Пароль не изменён',
        description: refusal.message,
        color: 'error',
        icon: 'i-lucide-triangle-alert',
      })
    }
  } finally {
    isChangingPassword.value = false
  }
}
</script>

<template>
  <div class="flex flex-col gap-8">
    <UButton
      to="/"
      color="neutral"
      variant="link"
      icon="i-lucide-arrow-left"
      label="Все встречи"
      class="-mx-2.5 self-start"
    />

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

    <template v-else>
      <section class="flex flex-col gap-4">
        <div class="flex items-center gap-3">
          <UIcon name="i-lucide-id-card" class="size-5 shrink-0 text-primary" />
          <h2 class="text-xl font-semibold tracking-tight text-highlighted">Имя</h2>
        </div>

        <UCard>
          <!-- Одно объявление о загрузке на всю страницу; сами `USkeleton`
               уходят под `aria-hidden`: каждый рендерит свой `role="alert"` с
               английским «loading». Высоты — по строкам готовой формы:
               пояснение, подпись, поле, подсказка, кнопка. -->
          <template v-if="isLoading">
            <span role="status" class="sr-only">Загружаем профиль</span>
            <div aria-hidden="true" class="flex flex-col items-start gap-5">
              <USkeleton class="h-5 w-80 max-w-full" />
              <div class="flex w-full flex-col gap-1">
                <USkeleton class="h-5 w-12" />
                <USkeleton class="h-9 w-full sm:max-w-md" />
                <USkeleton class="mt-1 h-5 w-64 max-w-full" />
              </div>
              <USkeleton class="h-9 w-28" />
            </div>
          </template>

          <div v-else-if="user" class="flex flex-col gap-5">
            <!-- В одну строку и на 360px: заглушка при загрузке — тоже одна. -->
            <p class="text-sm text-muted">В кабинете — крупно, над адресом почты.</p>

            <ProfileNameForm
              :name="user.name"
              :loading="isSavingName"
              :failure="nameFailure"
              @submit="onSaveName"
            />
          </div>
        </UCard>
      </section>

      <section class="flex flex-col gap-4">
        <div class="flex items-center gap-3">
          <UIcon name="i-lucide-key-round" class="size-5 shrink-0 text-primary" />
          <h2 class="text-xl font-semibold tracking-tight text-highlighted">Пароль</h2>
        </div>

        <UCard>
          <!-- Своего `role="status"` у блока нет: о загрузке страницы уже
               сообщает блок «Имя». Геометрия та же, что у готовой формы:
               пояснение, три поля с подсказками, кнопка. -->
          <div v-if="isLoading" aria-hidden="true" class="flex flex-col items-start gap-5">
            <USkeleton class="h-5 w-64 max-w-full" />
            <div v-for="row in 3" :key="row" class="flex w-full flex-col gap-1">
              <USkeleton class="h-5 w-40" />
              <USkeleton class="h-9 w-full sm:max-w-md" />
              <USkeleton class="mt-1 h-5 w-56 max-w-full" />
            </div>
            <USkeleton class="h-9 w-40" />
          </div>

          <div v-else-if="user" class="flex flex-col gap-5">
            <!-- В одну строку и на 360px, как пояснение у имени. -->
            <p class="text-sm text-muted">Выйдут все устройства, кроме этого.</p>

            <ProfilePasswordForm
              :email="user.email"
              :loading="isChangingPassword"
              :failure="passwordFailure"
              @submit="onChangePassword"
            />
          </div>
        </UCard>
      </section>
    </template>
  </div>
</template>
