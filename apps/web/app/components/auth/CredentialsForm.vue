<script setup lang="ts">
import type { FormErrorEvent } from '@nuxt/ui'

import type { AuthFailure, Credentials } from '~/types/auth'
import { validateCredentials } from '~/utils/auth'

/**
 * Одна форма на вход и на регистрацию. Различий между экранами ровно столько,
 * сколько пропсов ниже; всё остальное — валидация, перенос фокуса, объявление
 * ошибок — общее, и держать это в двух файлах значило бы починить доступность
 * в одном и забыть про второй.
 */
interface Props {
  /** Подпись кнопки отправки: «Войти» или «Создать аккаунт». */
  submitLabel: string
  /**
   * `current-password` для входа, `new-password` для регистрации. От этого
   * зависит, предложит браузер сохранённый пароль или сгенерирует новый, —
   * и по этому же атрибуту поле ищется в DOM для переноса фокуса.
   */
  passwordAutocomplete: 'current-password' | 'new-password'
  /** Подсказки под полями. Нужны и затем, чтобы строка под полем существовала
   *  заранее: иначе текст ошибки сдвигает вёрстку на высоту строки. */
  emailHelp: string
  passwordHelp: string
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
const formId = useId()

const state = reactive<Credentials>({ email: '', password: '' })
const isPasswordVisible = shallowRef(false)

// Отказ без поля — про запрос целиком (api недоступен, неверная пара логин/пароль,
// 5xx), такому место в алерте над формой, а не под одним из полей.
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
 * Текст про пустой пароль выводится из `autocomplete`, а не приходит отдельным
 * пропом: `new-password` и есть «регистрация», `current-password` — «вход»,
 * второй флаг о том же разъехался бы с первым при первой же правке.
 */
const emptyPasswordMessage = computed(() =>
  props.passwordAutocomplete === 'new-password' ? 'Придумайте пароль' : 'Введите пароль',
)

const validate = (state: Partial<Credentials>) =>
  validateCredentials(state, emptyPasswordMessage.value)

/**
 * Поле ищем по `autocomplete`, а не по `type`: у пароля тип переключается на
 * `text`, когда включён показ, и селектор по типу перестаёт его находить.
 */
const focusInForm = (selector: string) => {
  document.getElementById(formId)?.querySelector<HTMLElement>(selector)?.focus()
}

const focusField = (field: keyof Credentials) => {
  const selector =
    field === 'email'
      ? 'input[autocomplete="email"]'
      : `input[autocomplete="${props.passwordAutocomplete}"]`

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
    :id="formId"
    :state="state"
    :validate="validate"
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
      :help="props.emailHelp"
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
      :help="props.passwordHelp"
      :error="passwordError"
    >
      <UInput
        v-model="state.password"
        :type="passwordType"
        :autocomplete="props.passwordAutocomplete"
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

    <UButton type="submit" size="lg" block :loading="props.loading" :label="props.submitLabel" />
  </UForm>
</template>
