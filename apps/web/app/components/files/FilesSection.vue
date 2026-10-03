<script setup lang="ts">
import type { ActiveUpload } from '~/composables/useActiveUpload'
import type { MeetingFile } from '~/types/files'
import { MAX_FILES_PER_MEETING } from '~/utils/files'
import { plural } from '~/utils/meetings'

interface Props {
  files: MeetingFile[]
  /** Список ещё грузится. Отличать от «пусто» обязательно: тексты разные. */
  pending?: boolean
  /** Текст отказа api. `null` — отказа не было. */
  failure?: string | null
  /** Файл, который сейчас уезжает на api, или `null`. */
  upload?: ActiveUpload | null
  /** Id файла, который сейчас удаляется. */
  deletingId?: string | null
}

interface Emits {
  /** `ignored` — сколько файлов из брошенных разом осталось без внимания. */
  select: [file: File, ignored: number]
  cancel: []
  retry: []
  delete: [file: MeetingFile]
  linkExpired: []
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

const FILE_FORMS = { one: 'файл', few: 'файла', many: 'файлов' }

const countLabel = computed(() => plural(props.files.length, FILE_FORMS))

const isFull = computed(() => props.files.length >= MAX_FILES_PER_MEETING)

const heading = useTemplateRef<HTMLHeadingElement>('heading')

/**
 * Куда вернуть фокус после удаления: строка вместе с её кнопкой исчезает, и без
 * этого фокус улетает в `body`, а Tab начинает обход страницы с начала.
 */
const focusHeading = () => heading.value?.focus()

defineExpose({ focusHeading })
</script>

<template>
  <section class="flex flex-col gap-4">
    <div class="flex items-center gap-3">
      <UIcon name="i-lucide-paperclip" class="size-5 shrink-0 text-primary" />
      <h2
        ref="heading"
        tabindex="-1"
        class="text-xl font-semibold tracking-tight text-highlighted focus:outline-none"
      >
        Файлы
      </h2>
      <UBadge v-if="!props.pending" color="neutral" variant="subtle" :label="countLabel" />
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

    <template v-else>
      <!-- Пока файл уезжает, на месте зоны — его строка с процентом и отменой:
           второй файл параллельно всё равно не принимается, а одна и та же
           площадь не прыгает между «зона» и «зона плюс строка». -->
      <FilesUploadProgress v-if="props.upload" :upload="props.upload" @cancel="emit('cancel')" />

      <!-- Встреча заполнена — зона выключена и объясняет почему, а не ждёт,
           пока пользователь выберет файл ради отказа. -->
      <p v-else-if="isFull" class="rounded-lg border border-default p-4 text-sm text-muted">
        Во встрече уже {{ MAX_FILES_PER_MEETING }} файлов — это предел. Удалите ненужный, чтобы
        загрузить новый.
      </p>

      <FilesFileDropzone v-else @select="(file, ignored) => emit('select', file, ignored)" />

      <UCard v-if="props.files.length" :ui="{ body: 'py-0 sm:py-0' }">
        <!-- divide-y вместо рамки у каждой строки: между соседями одна линия,
             а по краям её даёт сама карточка. -->
        <ul class="divide-y divide-default">
          <FilesFileItem
            v-for="file in props.files"
            :key="file.id"
            :file="file"
            :deleting="props.deletingId === file.id"
            @delete="emit('delete', $event)"
            @link-expired="emit('linkExpired')"
          />
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
    </template>
  </section>
</template>
