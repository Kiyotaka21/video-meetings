<script setup lang="ts">
import type { AuthFailure, Credentials } from '~/types/auth'
import { describeRegisterFailure } from '~/utils/auth'

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

    await navigateTo('/app')
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

    <UPageCard
      variant="subtle"
      spotlight
      icon="i-lucide-user-plus"
      description="Адрес почты и пароль — этого достаточно."
      class="order-first w-full lg:order-none lg:max-w-md lg:justify-self-end"
    >
      <template #title>
        <h2>Создать аккаунт</h2>
      </template>

      <AuthRegisterForm :loading="isSubmitting" :failure="failure" @submit="onSubmit" />
    </UPageCard>
  </div>
</template>
