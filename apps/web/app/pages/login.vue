<script setup lang="ts">
import type { AuthFailure, Credentials } from '~/types/auth'
import { describeLoginFailure } from '~/utils/auth'

// Страница пререндерится (routeRules '/login'), поэтому meta уезжают в статику,
// а форма оживает при гидратации.
useSeoMeta({
  title: 'Вход — Video Meetings',
  description: 'Войдите в аккаунт Video Meetings, чтобы управлять своими встречами.',
})

const { login } = useAuth()
const toast = useToast()

const isSubmitting = shallowRef(false)
const failure = shallowRef<AuthFailure | null>(null)

const onSubmit = async (credentials: Credentials) => {
  isSubmitting.value = true
  failure.value = null

  try {
    await login(credentials)

    toast.add({
      title: 'Вы вошли',
      description: 'Токен сохранён в этом браузере.',
      color: 'success',
      icon: 'i-lucide-circle-check',
    })

    await navigateTo('/')
  } catch (error) {
    failure.value = describeLoginFailure(error)
  } finally {
    isSubmitting.value = false
  }
}
</script>

<template>
  <div class="mx-auto flex w-full max-w-md flex-col gap-6">
    <UPageCard
      variant="subtle"
      spotlight
      icon="i-lucide-log-in"
      description="Введите адрес почты и пароль, которые указали при регистрации."
    >
      <template #title>
        <h1>Вход</h1>
      </template>

      <AuthCredentialsForm
        submit-label="Войти"
        password-autocomplete="current-password"
        email-help="Адрес, на который заведён аккаунт"
        password-help="Тот, что вы задали при регистрации"
        :loading="isSubmitting"
        :failure="failure"
        @submit="onSubmit"
      />
    </UPageCard>

    <!-- `inline-block py-1` — про высоту цели нажатия, см. комментарий на
         `/register`: 18px у inline-ссылки превращаются в 26px. -->
    <p class="text-center text-sm text-muted">
      Ещё нет аккаунта?
      <ULink to="/register" class="inline-block py-1 font-medium text-primary">
        Зарегистрируйтесь
      </ULink>
    </p>
  </div>
</template>
