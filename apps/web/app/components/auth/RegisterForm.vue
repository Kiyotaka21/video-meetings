<script setup lang="ts">
import type { FormErrorEvent } from '@nuxt/ui'

import type { AuthFailure, Credentials } from '~/types/auth'
import { PASSWORD_MIN_LENGTH, validateCredentials } from '~/utils/auth'

interface Props {
  /** Запрос в полёте: блокирует поля и включает индикатор на кнопке. */
  loading?: boolean
  /** Отказ от api. Компонент только показывает его, решение о повторе — за страницей. */
  failure?: AuthFailure | null
}

interface Emits {
  submit: [credentials: Credentials]
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

/** Нужен, чтобы найти поле в DOM для переноса фокуса: id инпутов генерирует Nuxt UI. */
const FORM_ID = 'register-form'

const state = reactive<Credentials>({ email: '', password: '' })
const isPasswordVisible = shallowRef(false)

// Отказ без поля — про запрос целиком (api недоступен, 5xx), такому место в алерте.
const requestError = computed(() =>
  props.failure && !props.failure.field ? props.failure.message : null,
)
const emailError = computed(() =>
  props.failure?.field === 'email' ? props.failure.message : undefined,
)
const passwordError = computed(() =>
  props.failure?.field === 'password' ? props.failure.message : undefined,
)

const passwordType = computed(() => (isPasswordVisible.value ? 'text' : 'password'))

/**
 * Поле ищем по `autocomplete`, а не по `type`: у пароля тип переключается на
 * `text`, когда включён показ, и селектор по типу перестаёт его находить.
 */
const focusInForm = (selector: string) => {
  document.getElementById(FORM_ID)?.querySelector<HTMLElement>(selector)?.focus()
}

const focusField = (field: keyof Credentials) => {
  const selector =
    field === 'email' ? 'input[autocomplete="email"]' : 'input[autocomplete="new-password"]'

  focusInForm(selector)
}

/**
 * Без переноса фокуса неудачная отправка проходит молча: сообщения появляются
 * под полями, но фокус остаётся на кнопке, и скринридер о них не объявляет.
 *
 * Отсюда же `:loading-auto="false"` на форме: со включённым авто-режимом UForm
 * выключает поля на время отправки, а disabled-инпут фокус не принимает.
 */
const onValidationError = (event: FormErrorEvent) => {
  const first = event.errors[0]

  if (first?.id) {
    document.getElementById(first.id)?.focus()
  }
}

/**
 * Отказ api: курсор ставим туда, где правка, либо возвращаем на кнопку.
 * `flush: 'post'` обязателен: по умолчанию watcher срабатывает до перерисовки, а
 * в этот момент поле ещё выключено пропом `loading` и фокус не примет.
 */
watch(
  () => props.failure,
  (failure) => {
    if (!failure) {
      return
    }

    if (failure.field) {
      focusField(failure.field)
      return
    }

    // Отказ про запрос целиком: сам текст объявит role="alert", а фокус
    // возвращаем на кнопку — на время запроса она была выключена, и фокус
    // с неё уехал на body, то есть Tab начинал бы обход страницы заново.
    focusInForm('button[type="submit"]')
  },
  { flush: 'post' },
)

/**
 * `UForm` пропускает `@submit` только после успешной валидации, поэтому наверх
 * уходит копия локального состояния — типизированная, в отличие от payload'а
 * формы без схемы.
 */
const onSubmit = () => emit('submit', { ...state })
</script>

<template>
  <UForm
    :id="FORM_ID"
    :state="state"
    :validate="validateCredentials"
    :disabled="props.loading"
    :loading-auto="false"
    novalidate
    class="flex flex-col gap-5"
    @submit="onSubmit"
    @error="onValidationError"
  >
    <UAlert
      v-if="requestError"
      role="alert"
      color="error"
      variant="subtle"
      icon="i-lucide-triangle-alert"
      :description="requestError"
    />

    <UFormField
      name="email"
      label="Электронная почта"
      required
      help="Понадобится для входа"
      :error="emailError"
    >
      <UInput
        v-model="state.email"
        type="email"
        autocomplete="email"
        required
        placeholder="you@example.com"
        icon="i-lucide-mail"
        size="lg"
        class="w-full"
        :ui="{ base: 'placeholder:text-muted' }"
      />
    </UFormField>

    <UFormField
      name="password"
      label="Пароль"
      required
      :error="passwordError"
      :help="`Минимум ${PASSWORD_MIN_LENGTH} символов`"
    >
      <UInput
        v-model="state.password"
        :type="passwordType"
        autocomplete="new-password"
        required
        icon="i-lucide-lock"
        size="lg"
        class="w-full"
      >
        <template #trailing>
          <UButton
            color="neutral"
            variant="link"
            size="sm"
            :icon="isPasswordVisible ? 'i-lucide-eye-off' : 'i-lucide-eye'"
            :aria-label="isPasswordVisible ? 'Скрыть пароль' : 'Показать пароль'"
            :aria-pressed="isPasswordVisible"
            @click="isPasswordVisible = !isPasswordVisible"
          />
        </template>
      </UInput>
    </UFormField>

    <UButton type="submit" size="lg" block :loading="props.loading" label="Создать аккаунт" />
  </UForm>
</template>
