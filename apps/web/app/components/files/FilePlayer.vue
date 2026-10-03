<script setup lang="ts">
interface Props {
  /** Полный адрес отдачи на api, с файловым токеном. */
  src: string
  name: string
  media: 'video' | 'audio'
}

interface Emits {
  /**
   * Плеер не смог взять файл. Чаще всего это протухшая ссылка: токен живёт 15
   * минут, а 401 от api `<video>` не отличает от битого файла — оба приходят
   * как `MEDIA_ERR_SRC_NOT_SUPPORTED`.
   */
  error: []
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

const label = computed(() =>
  props.media === 'video' ? `Видеозапись «${props.name}»` : `Аудиозапись «${props.name}»`,
)
</script>

<template>
  <!-- `preload="metadata"`: длительность и первый кадр — да, весь файл — нет;
       автозапуска нет, перемотка — запросами с `Range`, которые api отдаёт 206.
       `aspect-video` держит место под видео заранее: иначе при загрузке
       метаданных строка вырастала бы и толкала список вниз. -->
  <video
    v-if="props.media === 'video'"
    :src="props.src"
    controls
    preload="metadata"
    :aria-label="label"
    class="aspect-video w-full rounded-md bg-muted"
    @error="emit('error')"
  />
  <audio
    v-else
    :src="props.src"
    controls
    preload="metadata"
    :aria-label="label"
    class="w-full"
    @error="emit('error')"
  />
</template>
