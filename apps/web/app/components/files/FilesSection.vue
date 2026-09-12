<script setup lang="ts">
import type { MeetingFile } from '~/types/files'
import { plural } from '~/utils/meetings'

interface Props {
  files: MeetingFile[]
  /** Список ещё грузится. Отличать от «пусто» обязательно: тексты разные. */
  pending?: boolean
  /** Текст отказа api. `null` — отказа не было. */
  failure?: string | null
  /** Файл сейчас уезжает на api: кнопка занята. */
  uploading?: boolean
}

interface Emits {
  upload: [file: File]
  retry: []
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

const FILE_FORMS = { one: 'файл', few: 'файла', many: 'файлов' }

const countLabel = computed(() => plural(props.files.length, FILE_FORMS))

/**
 * `UFileUpload` держит выбранный файл в `v-model`, а нам он нужен один раз — на
 * отправку. Поэтому значение сразу сбрасывается: иначе второй выбор того же
 * файла не изменит модель и обработчик не сработает.
 */
const selected = ref<File | null>(null)

const onSelect = (file: File | null | undefined) => {
  selected.value = null

  if (file) {
    emit('upload', file)
  }
}
</script>

<template>
  <section class="flex flex-col gap-4">
    <div class="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
      <div class="flex items-center gap-3">
        <UIcon name="i-lucide-paperclip" class="size-5 shrink-0 text-primary" />
        <h2 class="text-xl font-semibold tracking-tight text-highlighted">Файлы</h2>
        <UBadge v-if="!props.pending" color="neutral" variant="subtle" :label="countLabel" />
      </div>

      <!-- Своя кнопка в слоте, а не `variant="button"`: у встроенной кнопки
           подпись не рендерится вовсе, остаётся одна иконка. `open()` всё так же
           открывает скрытый input, который компонент держит у себя. -->
      <UFileUpload
        v-slot="{ open }"
        v-model="selected"
        :multiple="false"
        :preview="false"
        @update:model-value="onSelect"
      >
        <UButton
          icon="i-lucide-upload"
          label="Загрузить файл"
          :loading="props.uploading"
          @click="open()"
        />
      </UFileUpload>
    </div>

    <UAlert
      v-if="props.failure"
      role="alert"
      color="error"
      variant="subtle"
      icon="i-lucide-triangle-alert"
      title="Файлы не загрузились"
      :description="props.failure"
      :actions="[
        { label: 'Повторить', color: 'error', variant: 'outline', onClick: () => emit('retry') },
      ]"
    />

    <div v-else-if="props.pending" class="flex flex-col gap-4">
      <!-- Одно объявление на весь блок: сами `USkeleton` уходят под
           `aria-hidden`, потому что каждый из них рендерит свой живой регион
           с английским «loading». -->
      <span role="status" class="sr-only">Загружаем файлы встречи</span>

      <UCard aria-hidden="true" :ui="{ body: 'py-0 sm:py-0' }">
        <ul class="divide-y divide-default">
          <li v-for="row in 2" :key="row" class="flex flex-col gap-2 py-4">
            <USkeleton class="h-5 w-48 sm:w-72" />
            <USkeleton class="h-4 w-56" />
          </li>
        </ul>
      </UCard>
    </div>

    <UCard v-else-if="props.files.length" :ui="{ body: 'py-0 sm:py-0' }">
      <!-- divide-y вместо рамки у каждой строки: между соседями одна линия,
           а по краям её даёт сама карточка. -->
      <ul class="divide-y divide-default">
        <FilesFileItem v-for="file in props.files" :key="file.id" :file="file" />
      </ul>
    </UCard>

    <!-- Пустой блок объясняет, что сюда класть, а не оставляет пустое место.
         Одной строкой в `description`: `title` у `UEmpty` рендерится жёстко
         как `<h2>` и внутри секции с таким же `<h2>` дал бы вторую равноправную
         секцию — заголовок ради оформления статуса. -->
    <UEmpty
      v-else
      icon="i-lucide-paperclip"
      description="Файлов пока нет. Приложите запись встречи или документ — они будут храниться вместе со встречей."
    />
  </section>
</template>
