<script setup lang="ts">
import type { ActiveUpload } from '~/composables/useActiveUpload'
import { formatFileSize } from '~/utils/files'

interface Props {
  upload: ActiveUpload
}

interface Emits {
  cancel: []
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

const isSaving = computed(() => props.upload.phase === 'saving')

/**
 * Текст состояния — и на экран, и для скринридера. После 100 % подпись
 * меняется на «Сохраняем…»: проценты считают байты, ушедшие в сокет, а не
 * записанные на диск, и для большого файла ответ api приходит заметно позже.
 */
const statusText = computed(() =>
  isSaving.value ? 'Сохраняем файл на сервере…' : `Отправлено ${props.upload.percent} %`,
)

/** Чтение процента скринридером — словами, а не голым числом. */
const valueText = (value: number | null | undefined) => `${value ?? 0} процентов`

/**
 * Живой регион объявляет только смену фазы. Процент в нём менялся бы десятки
 * раз в секунду и заглушал бы всё остальное; его можно прочитать с полосы.
 */
const phaseAnnouncement = computed(() =>
  isSaving.value
    ? `Файл ${props.upload.name} отправлен, сохраняем на сервере`
    : `Загружаем ${props.upload.name}`,
)
</script>

<template>
  <div class="flex flex-col gap-3 rounded-lg border border-default bg-elevated/50 p-4">
    <span role="status" class="sr-only">{{ phaseAnnouncement }}</span>

    <div class="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
      <div class="flex min-w-0 flex-col gap-1">
        <span class="font-medium break-all text-highlighted">{{ props.upload.name }}</span>
        <span class="text-sm text-muted">
          {{ formatFileSize(props.upload.size) }} · {{ statusText }}
        </span>
      </div>

      <!-- Отмена доступна и после 100 %: пока api не ответил, файл ещё не
           сохранён, и обрыв соединения так же убирает недописанное. -->
      <UButton
        color="neutral"
        variant="outline"
        icon="i-lucide-x"
        label="Отменить"
        :aria-label="`Отменить загрузку ${props.upload.name}`"
        @click="emit('cancel')"
      />
    </div>

    <!-- Пока байты идут — полоса с процентом; после — бегущая полоса без
         значения: сколько ещё ждать записи на диск, клиент не знает. -->
    <UProgress
      :model-value="isSaving ? null : props.upload.percent"
      :max="100"
      size="sm"
      :get-value-text="valueText"
      :aria-label="`Загрузка ${props.upload.name}`"
    />
  </div>
</template>
