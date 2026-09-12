<script setup lang="ts">
import type { MeetingFile } from '~/types/files'
import { FILE_KIND_ICONS, FILE_KIND_LABELS, formatFileSize, formatUploadedAt } from '~/utils/files'

interface Props {
  file: MeetingFile
}

const props = defineProps<Props>()

const icon = computed(() => FILE_KIND_ICONS[props.file.kind])
const kindLabel = computed(() => FILE_KIND_LABELS[props.file.kind])
</script>

<template>
  <li class="flex flex-col gap-2 py-4">
    <!-- `break-all`, а не `truncate`: имя файла — содержимое строки, и прятать
         его хвост за многоточием значит скрывать, чем файлы отличаются. -->
    <span class="font-medium break-all text-highlighted">{{ props.file.name }}</span>

    <div class="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-muted">
      <!-- Иконка внутри бейджа, а не отдельно: у отдельной декоративной иконки
           нет имени, и она добавляет строке ещё одну цель для взгляда. -->
      <UBadge color="neutral" variant="subtle" :icon="icon" :label="kindLabel" />
      <span>{{ formatFileSize(props.file.size) }}</span>
      <time :datetime="props.file.createdAt">{{ formatUploadedAt(props.file.createdAt) }}</time>
    </div>
  </li>
</template>
