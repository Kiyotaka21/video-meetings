<script setup lang="ts">
import type { AuthFailure, Credentials } from '~/types/auth'
import { describeRegisterFailure, PASSWORD_MIN_LENGTH } from '~/utils/auth'

// Страница пререндерится (routeRules '/register'), поэтому meta уезжают в статику.
useSeoMeta({
  title: 'Регистрация — Video Meetings',
  description: 'Создайте аккаунт Video Meetings: нужны только адрес почты и пароль.',
})

const { register } = useAuth()
const toast = useToast()

const isSubmitting = shallowRef(false)
const failure = shallowRef<AuthFailure | null>(null)

const onSubmit = async (credentials: Credentials) => {
  isSubmitting.value = true
  failure.value = null

  try {
    await register(credentials)

    toast.add({
      title: 'Аккаунт создан',
      description: 'Токен сохранён, вы вошли в систему.',
      color: 'success',
      icon: 'i-lucide-circle-check',
    })

    await navigateTo('/')
  } catch (error) {
    failure.value = describeRegisterFailure(error)
  } finally {
    isSubmitting.value = false
  }
}
</script>

<template>
  <div class="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
    <AuthRegisterAside />

    <div
      class="order-first flex w-full flex-col gap-6 lg:order-none lg:max-w-md lg:justify-self-end"
    >
      <UPageCard
        variant="subtle"
        spotlight
        icon="i-lucide-user-plus"
        description="Адрес почты и пароль — этого достаточно."
      >
        <template #title>
          <h2>Создать аккаунт</h2>
        </template>

        <AuthCredentialsForm
          submit-label="Создать аккаунт"
          password-autocomplete="new-password"
          email-help="Понадобится для входа"
          :password-help="`Минимум ${PASSWORD_MIN_LENGTH} символов`"
          :loading="isSubmitting"
          :failure="failure"
          @submit="onSubmit"
        />
      </UPageCard>

      <!-- `inline-block py-1` доводит высоту ссылки с 18px до 26px. Формально
           inline-ссылка в предложении подпадает под исключение WCAG 2.5.8
           (размер ограничен line-height соседнего текста), но это единственный
           переход между входом и регистрацией, и на телефоне в него надо попасть. -->
      <p class="text-center text-sm text-muted">
        Уже есть аккаунт?
        <ULink to="/login" class="inline-block py-1 font-medium text-primary">Войдите</ULink>
      </p>
    </div>
  </div>
</template>
