<script setup lang="ts">
import type { Meeting } from '~/types/meetings'
import { MEETING_FORMS, plural } from '~/utils/meetings'

interface Props {
  title: string
  icon: string
  meetings: Meeting[]
  /**
   * Текст заглушки для пустого списка. Не задан — блок с пустым списком просто
   * не рисуется: у «последних встреч» отсутствие записей не новость, о которой
   * надо сообщать, в отличие от пустого расписания.
   *
   * Одной строкой, а не парой «заголовок + описание»: `title` у `UEmpty`
   * рендерится жёстко как `<h2>`, и внутри секции с таким же `<h2>` получалась
   * бы вторая равноправная секция — заголовок ради оформления статуса.
   */
  empty?: string
}

const props = defineProps<Props>()

/** Счётчик со словом, а не голое число: «3» скринридер объявит без контекста. */
const countLabel = computed(() => plural(props.meetings.length, MEETING_FORMS))
</script>

<template>
  <section v-if="props.meetings.length || props.empty" class="flex flex-col gap-4">
    <div class="flex items-center gap-3">
      <UIcon :name="props.icon" class="size-5 shrink-0 text-primary" />
      <h2 class="text-xl font-semibold tracking-tight text-highlighted">{{ props.title }}</h2>
      <UBadge color="neutral" variant="subtle" :label="countLabel" />
    </div>

    <UCard v-if="props.meetings.length" :ui="{ body: 'py-0 sm:py-0' }">
      <!-- divide-y вместо рамки у каждой строки: между соседями одна линия,
           а у первой и последней её нет — карточка сама даёт границу. -->
      <ul class="divide-y divide-default">
        <MeetingsMeetingItem
          v-for="meeting in props.meetings"
          :key="meeting.id"
          :meeting="meeting"
        />
      </ul>
    </UCard>

    <UEmpty v-else-if="props.empty" :icon="props.icon" :description="props.empty" />
  </section>
</template>
