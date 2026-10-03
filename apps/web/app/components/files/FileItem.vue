<script setup lang="ts">
import type { MeetingFile } from '~/types/files'
import {
  FILE_MEDIA_ICONS,
  FILE_MEDIA_LABELS,
  formatFileSize,
  formatUploadedAt,
  mediaOf,
} from '~/utils/files'

interface Props {
  file: MeetingFile
}

const props = defineProps<Props>()

const media = computed(() => mediaOf(props.file))
const icon = computed(() => FILE_MEDIA_ICONS[media.value])
const kindLabel = computed(() => FILE_MEDIA_LABELS[media.value])
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
