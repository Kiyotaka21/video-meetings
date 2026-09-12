<script setup lang="ts">
import type { Meeting } from '~/types/meetings'
import {
  formatMeetingDate,
  PARTICIPANT_FORMS,
  PARTICIPANTS_PREVIEW_LIMIT,
  plural,
} from '~/utils/meetings'

interface Props {
  meeting: Meeting
}

const props = defineProps<Props>()

const participants = computed(() => props.meeting.participants)

/**
 * Адреса не выводятся все: api принимает до 100 участников, и сотня бейджей
 * растянула бы строку на пол-экрана. Показываем первые несколько, остальные —
 * одним счётчиком.
 */
const visibleParticipants = computed(() => participants.value.slice(0, PARTICIPANTS_PREVIEW_LIMIT))
const hiddenCount = computed(() =>
  Math.max(participants.value.length - PARTICIPANTS_PREVIEW_LIMIT, 0),
)

/** «+2» скринридер объявит как «плюс два» — без слова непонятно, чего два. */
const hiddenLabel = computed(() => `ещё ${plural(hiddenCount.value, PARTICIPANT_FORMS)}`)
</script>

<template>
  <li class="flex flex-col gap-3 py-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
    <div class="flex min-w-0 flex-col gap-1">
      <h3 class="font-medium break-words text-highlighted">
        <!-- Ссылка на самом названии, а не на всей строке: строка содержит ещё
             и бейджи участников, а вложенных интерактивных элементов в ссылке
             быть не должно.

             Индикатор фокуса задан руками — у голого `NuxtLink`, в отличие от
             `UButton`, своего нет. Вертикальные отступы с компенсирующим
             минусом поднимают цель нажатия до 24px, не сдвигая вёрстку. -->
        <NuxtLink
          :to="`/meetings/${props.meeting.id}`"
          class="-my-1 inline-block rounded-(--ui-radius) py-1 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          {{ props.meeting.title }}
        </NuxtLink>
      </h3>

      <!-- datetime в машинном виде: текст локализован и в разборе не поможет. -->
      <time :datetime="props.meeting.date" class="text-sm text-muted">
        {{ formatMeetingDate(props.meeting.date) }}
      </time>
    </div>

    <ul
      v-if="participants.length"
      class="flex min-w-0 flex-wrap gap-1.5 sm:max-w-[55%] sm:justify-end"
    >
      <li v-for="participant in visibleParticipants" :key="participant" class="min-w-0">
        <UBadge color="neutral" variant="subtle" class="max-w-full break-all">
          {{ participant }}
        </UBadge>
      </li>

      <li v-if="hiddenCount">
        <UBadge color="neutral" variant="soft" :aria-label="hiddenLabel">
          +{{ hiddenCount }}
        </UBadge>
      </li>
    </ul>

    <!-- `text-muted`, а не `text-dimmed`: последний даёт 2.62:1 на фоне карточки
         против нормы 4.5:1, а это содержательная строка, а не декор. -->
    <p v-else class="text-sm text-muted">Без участников</p>
  </li>
</template>
