<script setup lang="ts">
import { DOCUMENT_FORMATS_HINT, FILE_ACCEPT, RECORDING_FORMATS_HINT } from '~/utils/files'

interface Props {
  /** Идёт загрузка: второй файл параллельно не принимается. */
  disabled?: boolean
}

interface Emits {
  /** `ignored` — сколько файлов из брошенных разом осталось без внимания. */
  select: [file: File, ignored: number]
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

const description = `Записи (${RECORDING_FORMATS_HINT}) — до 2 ГБ, документы (${DOCUMENT_FORMATS_HINT}) — до 50 МБ. Один файл за раз.`

/**
 * Сколько файлов бросили последним перетаскиванием. `UFileUpload` при
 * `multiple: false` молча берёт первый (`useFileUpload` в Nuxt UI), а сказать
 * об этом пользователю надо нам. Счёт снимается в фазе захвата на обёртке —
 * раньше, чем обработчик компонента выберет файл, — потому что свои атрибуты
 * `UFileUpload` отдаёт скрытому `input`, а не корню.
 */
let dropped = 0

const onDropCapture = (event: DragEvent) => {
  dropped = event.dataTransfer?.files.length ?? 0
}

const onSelect = (file: File | null | undefined) => {
  const ignored = Math.max(dropped - 1, 0)

  dropped = 0

  if (file) {
    emit('select', file, ignored)
  }
}
</script>

<template>
  <!-- `:model-value="null"` — компонент не держит выбранный файл: он нужен один
       раз, на отправку. `reset` очищает скрытый input при каждом открытии
       диалога — иначе повторный выбор того же файла (после отказа или обрыва)
       не давал `change`, и ничего не происходило. -->
  <div @drop.capture="onDropCapture">
    <UFileUpload
      :model-value="null"
      :multiple="false"
      :preview="false"
      :accept="FILE_ACCEPT"
      reset
      :disabled="props.disabled"
      icon="i-lucide-upload"
      label="Перетащите файл сюда или нажмите, чтобы выбрать"
      :description="description"
      class="w-full"
      :ui="{ base: 'min-h-36' }"
      @update:model-value="onSelect"
    />
  </div>
</template>
