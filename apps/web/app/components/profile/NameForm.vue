<script setup lang="ts">
import type { FormErrorEvent } from '@nuxt/ui'

import { NAME_MAX_LENGTH, type NameState, validateName } from '~/utils/profile'

interface Props {
  /** Сохранённое имя из `/auth/me`; `null` — не задано. С него форма стартует. */
  name: string | null
  /** Запрос в полёте: блокирует поле и включает индикатор на кнопке. */
  loading?: boolean
  /**
   * Отказ api — текст под полем. Компонент только показывает его, решение о
   * повторе — за страницей.
   */
  failure?: string | null
}

interface Emits {
  submit: [name: string]
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

/** Нужен, чтобы найти поле и кнопку в DOM: id инпута генерирует Nuxt UI. */
const formId = useId()

const state = reactive<NameState>({ name: props.name ?? '' })

const focusInForm = (selector: string) => {
  document.getElementById(formId)?.querySelector<HTMLElement>(selector)?.focus()
}

/**
 * Без переноса фокуса неудачная отправка проходит молча: текст появляется под
 * полем, но скринридер его не объявит — `aria-describedby` читается только при
 * заходе в поле.
 */
const onValidationError = (event: FormErrorEvent) => {
  const first = event.errors[0]

  if (first?.id) {
    document.getElementById(first.id)?.focus()
  }
}

/** Что держало фокус в момент отправки: поле (Enter) или кнопка (клик). */
let focusedOnSubmit: HTMLElement | null = null

/**
 * Конец запроса. Пока он шёл, поле и кнопка были выключены, и фокус с них
 * уехал в `body`, — без возврата Tab начинал бы обход страницы с начала.
 *
 * Отказ — курсор в поле, к тексту ошибки под ним. Успех — поле показывает то,
 * что api сохранил, а не то, что набрали: пробелы по краям он срезал, пустое
 * превратил в `null`. Сверять через `watch(() => props.name)` нельзя — при
 * сохранении «  Анна  » поверх «Анна» имя не меняется, и пробелы остались бы.
 *
 * `flush: 'post'` обязателен: до перерисовки поле ещё выключено и фокус не
 * примет.
 */
watch(
  () => props.loading,
  (loading, wasLoading) => {
    if (loading || !wasLoading) {
      return
    }

    if (props.failure) {
      focusInForm('input')

      return
    }

    state.name = props.name ?? ''

    if (focusedOnSubmit?.isConnected) {
      focusedOnSubmit.focus()
    } else {
      focusInForm('button[type="submit"]')
    }
  },
  { flush: 'post' },
)

/**
 * `UForm` пропускает `@submit` только после успешной валидации, так что наверх
 * уходит строка, которую api примет. Как набрана — без обрезки: нормализует
 * api, и в поле после ответа вернётся его результат.
 */
const onSubmit = () => {
  focusedOnSubmit = document.activeElement instanceof HTMLElement ? document.activeElement : null
  emit('submit', state.name)
}
</script>

<template>
  <!-- `novalidate` и `:loading-auto="false"` — по тем же причинам, что у
       `AuthCredentialsForm`: свой текст ошибки вместо пузыря браузера, и поле
       не выключается на время валидации, иначе фокус в него не перенести. -->
  <UForm
    :id="formId"
    :state="state"
    :validate="validateName"
    :disabled="props.loading"
    :loading-auto="false"
    novalidate
    class="flex flex-col items-start gap-5"
    @submit="onSubmit"
    @error="onValidationError"
  >
    <!-- `help` есть всегда: строка под полем существует заранее, и текст ошибки,
         который `UFormField` ставит на её место, ничего не сдвигает. Поэтому и
         подсказка, и все тексты ошибок — в одну строку на 360px. -->
    <UFormField
      name="name"
      label="Имя"
      :help="`До ${NAME_MAX_LENGTH} символов. Пустое поле — без имени.`"
      :error="props.failure ?? undefined"
      class="w-full"
    >
      <UInput
        v-model="state.name"
        autocomplete="name"
        placeholder="Например, Анна Петрова"
        icon="i-lucide-user"
        size="lg"
        class="w-full sm:max-w-md"
        :ui="{ base: 'placeholder:text-muted' }"
      />
    </UFormField>

    <UButton type="submit" size="lg" :loading="props.loading" label="Сохранить" />
  </UForm>
</template>
