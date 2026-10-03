<script setup lang="ts">
import type { MeetingFile } from '~/types/files'
import { apiHref } from '~/utils/api'
import {
  FILE_MEDIA_ICONS,
  FILE_MEDIA_LABELS,
  FILE_STATUS_LABELS,
  formatFileSize,
  formatUploadedAt,
  mediaOf,
} from '~/utils/files'

interface Props {
  file: MeetingFile
  /** Файл сейчас удаляется: кнопка занята, второй клик не уйдёт. */
  deleting?: boolean
}

interface Emits {
  delete: [file: MeetingFile]
  /** Плеер не взял ссылку — пусть страница перезапросит список со свежими. */
  linkExpired: []
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

const { apiUrl } = useRuntimeConfig().public

const media = computed(() => mediaOf(props.file))
const icon = computed(() => FILE_MEDIA_ICONS[media.value])
const kindLabel = computed(() => FILE_MEDIA_LABELS[media.value])
const href = computed(() => apiHref(apiUrl, props.file.url))

const playerId = useId()

/**
 * Адрес, с которым открыт плеер, — снимок, а не живой `href`. Страница
 * обновляет ссылки по таймеру, и живой адрес перезапускал бы запись посреди
 * просмотра. Новый адрес плеер берёт только после своей же ошибки.
 */
const playerSrc = shallowRef<string | null>(null)
const isRetrying = shallowRef(false)
const playerFailed = shallowRef(false)

const isPlayerOpen = computed(() => playerSrc.value !== null)

const togglePlayer = () => {
  playerSrc.value = isPlayerOpen.value ? null : href.value
  isRetrying.value = false
  playerFailed.value = false
}

/**
 * Первая ошибка — скорее всего протухшая ссылка: просим свежий список один раз.
 * Вторая — файл и правда не играет, и повторять запрос бессмысленно: на битом
 * файле получился бы бесконечный цикл.
 */
const onPlayerError = () => {
  if (isRetrying.value) {
    isRetrying.value = false
    playerFailed.value = true

    return
  }

  isRetrying.value = true
  emit('linkExpired')
}

watch(href, (fresh) => {
  if (isRetrying.value && isPlayerOpen.value) {
    playerSrc.value = fresh
  }
})
</script>

<template>
  <li class="flex flex-col gap-3 py-4">
    <div class="flex flex-col gap-2">
      <!-- `break-all`, а не `truncate`: имя файла — содержимое строки, и прятать
           его хвост за многоточием значит скрывать, чем файлы отличаются. -->
      <span class="font-medium break-all text-highlighted">{{ props.file.name }}</span>

      <div class="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-muted">
        <!-- Иконка внутри бейджа, а не отдельно: у отдельной декоративной иконки
             нет имени, и она добавляет строке ещё одну цель для взгляда. -->
        <UBadge color="neutral" variant="subtle" :icon="icon" :label="kindLabel" />
        <span>{{ formatFileSize(props.file.size) }}</span>
        <time :datetime="props.file.createdAt">{{ formatUploadedAt(props.file.createdAt) }}</time>
        <!-- Статус только у записей: к документам обработка не относится. -->
        <span v-if="media !== 'document'">{{ FILE_STATUS_LABELS[props.file.status] }}</span>
      </div>
    </div>

    <div class="flex flex-wrap items-center gap-2">
      <UButton
        v-if="media !== 'document'"
        color="neutral"
        variant="outline"
        size="sm"
        :icon="isPlayerOpen ? 'i-lucide-chevron-up' : 'i-lucide-play'"
        :label="isPlayerOpen ? 'Скрыть плеер' : media === 'video' ? 'Смотреть' : 'Слушать'"
        :aria-expanded="isPlayerOpen"
        :aria-controls="playerId"
        @click="togglePlayer"
      />

      <!-- Обычная ссылка, а не кнопка со скриптом: имя файла приезжает из
           `Content-Disposition` api — атрибут `download` на кросс-origin ссылке
           (5173 → 3000) браузер игнорирует. Страница при этом остаётся на месте:
           ответ с `attachment` навигацию не совершает. -->
      <UButton
        v-else
        :to="href"
        external
        color="neutral"
        variant="outline"
        size="sm"
        icon="i-lucide-download"
        label="Скачать"
        :aria-label="`Скачать ${props.file.name}`"
      />

      <UButton
        color="error"
        variant="ghost"
        size="sm"
        icon="i-lucide-trash-2"
        label="Удалить"
        :aria-label="`Удалить ${props.file.name}`"
        :loading="props.deleting"
        @click="emit('delete', props.file)"
      />
    </div>

    <div v-if="isPlayerOpen && playerSrc" :id="playerId" class="flex flex-col gap-2">
      <FilesFilePlayer
        :src="playerSrc"
        :name="props.file.name"
        :media="media === 'video' ? 'video' : 'audio'"
        @error="onPlayerError"
      />
      <p v-if="playerFailed" role="alert" class="text-sm text-error">
        Запись не воспроизводится. Попробуйте открыть её ещё раз позже.
      </p>
    </div>
  </li>
</template>
