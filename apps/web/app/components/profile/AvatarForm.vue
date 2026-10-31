<script setup lang="ts">
import type { AvatarAction } from '~/types/auth'
import { apiHref } from '~/utils/api'
import { AVATAR_ACCEPT } from '~/utils/profile'

interface Props {
  /** `avatarUrl` из `/auth/me` — путь от корня api; `null` — аватара нет. */
  avatarUrl: string | null
  /** Текстовая альтернатива картинке: имя, без имени — адрес. */
  alt: string
  /** Действие в полёте: обе кнопки заняты, на своей — индикатор. */
  busy?: AvatarAction | null
  /** Отказ — проверки до отправки или api; встаёт под кнопки на место подсказки. */
  failure?: string | null
}

interface Emits {
  /** Выбранный файл как есть: проверку до отправки делает страница. */
  select: [image: File]
  delete: []
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

const { apiUrl } = useRuntimeConfig().public

/**
 * Путь склеивается с `apiUrl`, как ссылка на файл встречи: вставленный в
 * `<img src>` как есть, он ушёл бы на origin фронтенда и получил 404 от Nuxt.
 */
const src = computed(() => (props.avatarUrl ? apiHref(apiUrl, props.avatarUrl) : undefined))

/** Нужны, чтобы вернуть фокус на кнопку и связать её с подсказкой. */
const uploadId = useId()
const deleteId = useId()
const messageId = useId()

const input = useTemplateRef<HTMLInputElement>('input')

/**
 * Номер выбора файла — ключ строки с отказом. Тот же отказ на следующий файл
 * (два GIF подряд) не меняет текст, и без нового ключа `role="alert"` не
 * перерисовался бы, а скринридер не объявил бы второй отказ.
 */
const attempt = shallowRef(0)

const openPicker = () => input.value?.click()

const onChange = () => {
  const picker = input.value
  const image = picker?.files?.[0]

  if (!picker || !image) {
    return
  }

  // Без сброса повторный выбор того же файла (после отказа или обрыва связи)
  // не дал бы `change` — та же ловушка, что была у зоны загрузки файлов.
  picker.value = ''
  attempt.value += 1
  emit('select', image)
}

/**
 * Конец запроса. Пока он шёл, кнопки были выключены, и фокус с них уехал в
 * `body` — без возврата Tab начинал бы обход страницы с начала. После удаления
 * кнопки «Удалить» уже нет, и фокус встаёт на «Загрузить»; после отказа
 * удаления — обратно на «Удалить».
 *
 * `flush: 'post'`: до перерисовки кнопки ещё выключены и фокус не примут.
 */
watch(
  () => props.busy,
  (busy, wasBusy) => {
    if (busy || !wasBusy) {
      return
    }

    const target = wasBusy === 'delete' && props.avatarUrl ? deleteId : uploadId

    document.getElementById(target)?.focus()
  },
  { flush: 'post' },
)
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="flex items-center gap-4">
      <!-- Круг 80px: `size-20` перекрывает размер по умолчанию, и по нему же
           `UAvatar` ставит `<img>` атрибуты `width` и `height`. `object-cover`
           у картинки — из темы: неквадратное фото обрезается по центру, а не
           сплющивается. Без аватара или с битой ссылкой — иконка-заглушка. -->
      <UAvatar
        :src="src"
        :alt="props.alt"
        icon="i-lucide-user"
        class="size-20"
        :ui="{ icon: 'size-10' }"
      />

      <!-- На 360px кнопки встают в два ряда (72px) и укладываются в высоту
           круга: строка не растёт, когда появляется «Удалить». -->
      <div class="flex flex-wrap gap-2">
        <UButton
          :id="uploadId"
          color="neutral"
          variant="outline"
          icon="i-lucide-image-up"
          :label="src ? 'Заменить' : 'Загрузить'"
          :aria-label="src ? 'Заменить аватар' : 'Загрузить аватар'"
          :aria-describedby="messageId"
          :loading="props.busy === 'upload'"
          :disabled="Boolean(props.busy)"
          @click="openPicker"
        />

        <UButton
          v-if="src"
          :id="deleteId"
          color="error"
          variant="ghost"
          icon="i-lucide-trash-2"
          label="Удалить"
          aria-label="Удалить аватар"
          :loading="props.busy === 'delete'"
          :disabled="Boolean(props.busy)"
          @click="emit('delete')"
        />
      </div>

      <!-- Сам выбор файла — скрытый `input`, открывает его кнопка: в дереве
           доступности и в обходе Tab'ом его нет. `accept` — подсказка диалогу,
           а не проверка. -->
      <input ref="input" type="file" :accept="AVATAR_ACCEPT" hidden @change="onChange" />
    </div>

    <!-- Подсказка в две строки, и место под них есть всегда (`min-h-10`):
         отказ встаёт на её место и ничего не сдвигает. Самые длинные тексты
         отказа на 360px занимают те же две строки. -->
    <div :id="messageId" class="min-h-10 text-sm">
      <p v-if="props.failure" :key="attempt" role="alert" class="text-error">
        {{ props.failure }}
      </p>

      <template v-else>
        <p class="text-muted">JPEG, PNG или WebP, до 2 МБ.</p>
        <p class="text-muted">Неквадратное фото обрежется по кругу.</p>
      </template>
    </div>
  </div>
</template>
