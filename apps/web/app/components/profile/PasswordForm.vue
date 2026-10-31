<script setup lang="ts">
import type { FormErrorEvent } from '@nuxt/ui'

import type { PasswordChange, PasswordChangeFailure } from '~/types/auth'
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  type PasswordChangeState,
  validatePasswordChange,
} from '~/utils/auth'

interface Props {
  /**
   * Адрес вошедшего — для скрытого поля `username`. По нему менеджер паролей
   * понимает, у какой учётки обновить сохранённый пароль.
   */
  email: string
  /** Запрос в полёте: блокирует поля и включает индикатор на кнопке. */
  loading?: boolean
  /**
   * Отказ api. С `field` текст встаёт под своё поле, без него форма только
   * возвращает фокус на кнопку — сам текст показывает страница тостом.
   */
  failure?: PasswordChangeFailure | null
}

interface Emits {
  submit: [change: PasswordChange]
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

type FieldName = keyof PasswordChangeState

interface Field {
  name: FieldName
  label: string
  autocomplete: 'current-password' | 'new-password'
  /** Строка под полем — в одну строку на 360px, как и все тексты ошибок. */
  help: string
  /** Чей пароль показывает кнопка-глаз: у трёх кнопок разные имена. */
  subject: string
}

const FIELDS: readonly Field[] = [
  {
    name: 'currentPassword',
    label: 'Текущий пароль',
    autocomplete: 'current-password',
    // Не «с которым вы вошли»: после смены в этой же вкладке это уже не так.
    help: 'Тот, которым входите сейчас',
    subject: 'текущий пароль',
  },
  {
    name: 'newPassword',
    label: 'Новый пароль',
    autocomplete: 'new-password',
    help: `От ${PASSWORD_MIN_LENGTH} до ${PASSWORD_MAX_LENGTH} символов, не как текущий`,
    subject: 'новый пароль',
  },
  {
    name: 'confirmPassword',
    label: 'Повторите новый пароль',
    autocomplete: 'new-password',
    help: 'Тот же, что в поле выше',
    subject: 'повтор пароля',
  },
]

/** Нужен, чтобы найти поля и кнопку в DOM: id инпутов генерирует Nuxt UI. */
const formId = useId()

/** Номер экземпляра `UForm`: после успешной смены форма собирается заново. */
const generation = shallowRef(0)

const emptyState = (): PasswordChangeState => ({
  currentPassword: '',
  newPassword: '',
  confirmPassword: '',
})

const state = reactive<PasswordChangeState>(emptyState())
const visible = reactive<Record<FieldName, boolean>>({
  currentPassword: false,
  newPassword: false,
  confirmPassword: false,
})

/** Отказ api по полю — вместе со значением, которое api отверг. */
interface Refusal {
  field: keyof PasswordChange
  message: string
  value: string
}

/**
 * Живёт здесь, а не в ошибках `UForm` (`setErrors`): туда же пишет отложенная
 * на 300 мс проверка поля по вводу, и ответ api, пришедший быстрее, она стирала
 * — замер в браузере.
 */
const refusal = shallowRef<Refusal | null>(null)

/**
 * Текст отказа — только пока в поле то, что api отверг: правка поля его
 * снимает, и под полем снова подсказка или ошибка проверки. Отдаётся в проп
 * `error`, который у `UFormField` сильнее ошибок формы.
 */
const refusalFor = (name: FieldName): string | undefined =>
  refusal.value?.field === name && state[name] === refusal.value.value
    ? refusal.value.message
    : undefined

const focusInForm = (selector: string) => {
  document.getElementById(formId)?.querySelector<HTMLElement>(selector)?.focus()
}

/**
 * Без переноса фокуса неудачная отправка проходит молча: текст появляется под
 * полем, но скринридер его не объявит — `aria-describedby` читается только при
 * заходе в поле. Ошибки приходят в порядке полей, так что первая — верхняя.
 */
const onValidationError = (event: FormErrorEvent) => {
  const first = event.errors[0]

  if (first?.id) {
    document.getElementById(first.id)?.focus()
  }
}

/**
 * Где был фокус в момент отправки: имя поля (Enter) или `null` — кнопка
 * (клик). Именно имя, а не сам элемент: после успеха форма собирается заново,
 * и прежнего элемента в DOM уже нет.
 */
let focusedOnSubmit: string | null = null

/**
 * Конец запроса. Пока он шёл, поля и кнопка были выключены, и фокус с них
 * уехал в `body`, — без возврата Tab начинал бы обход страницы с начала.
 *
 * Отказ по полю — текст под ним и курсор туда же. Отказ без поля — фокус на
 * кнопку, текст покажет страница тостом; введённое остаётся для повтора.
 *
 * Успех — поля пустые: пароль на экране после смены не нужен никому. Форма при
 * этом не очищается, а собирается заново (`:key`): у прежней могла остаться
 * отложенная проверка поля по вводу, и через 300 мс после ответа она пометила
 * бы уже пустое поле ошибкой «Введите текущий пароль». Размонтированное поле
 * свою отложенную проверку отменяет, а новая форма не помнит, какие поля
 * трогали.
 *
 * `flush: 'post'` обязателен: до перерисовки поля ещё выключены и фокус не
 * примут.
 */
watch(
  () => props.loading,
  async (loading, wasLoading) => {
    if (loading || !wasLoading) {
      return
    }

    const { failure } = props

    refusal.value = null

    if (failure?.field) {
      refusal.value = {
        field: failure.field,
        message: failure.message,
        value: state[failure.field],
      }

      // Сначала текст под полем, потом фокус: скринридер читает
      // `aria-describedby` в момент захода в поле.
      await nextTick()
      focusInForm(`input[name="${failure.field}"]`)

      return
    }

    if (failure) {
      focusInForm('button[type="submit"]')

      return
    }

    Object.assign(state, emptyState())
    generation.value += 1

    await nextTick()
    focusInForm(focusedOnSubmit ? `input[name="${focusedOnSubmit}"]` : 'button[type="submit"]')
  },
  { flush: 'post' },
)

/**
 * `UForm` пропускает `@submit` только после успешной валидации. Повтор нового
 * пароля на api не уходит: он нужен только здесь, чтобы опечатка не заперла
 * учётку — восстановления пароля нет.
 */
const onSubmit = () => {
  const active = document.activeElement

  focusedOnSubmit = active instanceof HTMLInputElement ? active.name : null
  emit('submit', { currentPassword: state.currentPassword, newPassword: state.newPassword })
}
</script>

<template>
  <!-- `novalidate` и `:loading-auto="false"` — по тем же причинам, что у
       `AuthCredentialsForm`: свой текст ошибки вместо пузыря браузера, и поля
       не выключаются на время валидации, иначе фокус в них не перенести.

       `validate-on` без `blur`: блок необязательный, и пройти Tab'ом по пустым
       полям — не ошибка. Поле проверяется, когда в нём что-то поменяли
       (`change` при уходе из поля, `input` после первого ухода), и вся форма —
       на отправке. -->
  <UForm
    :id="formId"
    :key="generation"
    :state="state"
    :validate="validatePasswordChange"
    :validate-on="['input', 'change']"
    :disabled="props.loading"
    :loading-auto="false"
    novalidate
    class="flex flex-col items-start gap-5"
    @submit="onSubmit"
    @error="onValidationError"
  >
    <!-- Скрытое поле с адресом: без него Chrome предупреждает, что у формы с
         паролем нет имени пользователя, а менеджер паролей не знает, у какой
         учётки сохранить новый. `hidden` убирает его и из обхода Tab'ом, и из
         дерева доступности. -->
    <input
      type="text"
      name="username"
      autocomplete="username"
      :value="props.email"
      readonly
      hidden
    />

    <!-- `help` есть у каждого поля: строка под полем существует заранее, и
         текст ошибки, который `UFormField` ставит на её место, ничего не
         сдвигает. Поэтому и подсказки, и все тексты ошибок — в одну строку на
         360px. -->
    <UFormField
      v-for="field in FIELDS"
      :key="field.name"
      :name="field.name"
      :label="field.label"
      :help="field.help"
      :error="refusalFor(field.name)"
      required
      class="w-full"
    >
      <UInput
        v-model="state[field.name]"
        :type="visible[field.name] ? 'text' : 'password'"
        :autocomplete="field.autocomplete"
        required
        icon="i-lucide-lock"
        size="lg"
        class="w-full sm:max-w-md"
      >
        <template #trailing>
          <UButton
            color="neutral"
            variant="link"
            size="sm"
            :icon="visible[field.name] ? 'i-lucide-eye-off' : 'i-lucide-eye'"
            :aria-label="`${visible[field.name] ? 'Скрыть' : 'Показать'} ${field.subject}`"
            :aria-pressed="visible[field.name]"
            @click="visible[field.name] = !visible[field.name]"
          />
        </template>
      </UInput>
    </UFormField>

    <UButton
      type="submit"
      size="lg"
      color="neutral"
      variant="outline"
      :loading="props.loading"
      label="Сменить пароль"
    />
  </UForm>
</template>
