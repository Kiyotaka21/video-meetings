<script setup lang="ts">
import type { Meeting } from '~/types/meetings'
import { formatMeetingDate, PARTICIPANT_FORMS, plural } from '~/utils/meetings'

interface Props {
  /** `null` — встреча ещё не пришла: либо запрос в полёте, либо он отказал. */
  meeting: Meeting | null
  pending?: boolean
}

const props = defineProps<Props>()

const participants = computed(() => props.meeting?.participants ?? [])

/** «3» скринридер объявит без контекста — считаем со словом. */
const countLabel = computed(() => plural(participants.value.length, PARTICIPANT_FORMS))
</script>

<template>
  <UCard>
    <div v-if="props.meeting" class="flex flex-col gap-4">
      <div class="flex flex-col gap-2">
        <h1 class="text-2xl font-semibold tracking-tight break-words text-highlighted sm:text-3xl">
          {{ props.meeting.title }}
        </h1>

        <!-- datetime в машинном виде: текст локализован и в разборе не поможет. -->
        <time :datetime="props.meeting.date" class="text-muted">
          {{ formatMeetingDate(props.meeting.date) }}
        </time>
      </div>

      <div v-if="participants.length" class="flex flex-col gap-2">
        <h2 class="text-sm font-medium text-muted">Участники: {{ countLabel }}</h2>

        <!-- Все адреса, без сворачивания в «+N»: на странице одной встречи
             список участников — это содержимое, а не подпись к строке. -->
        <ul class="flex flex-wrap gap-1.5">
          <li v-for="participant in participants" :key="participant" class="min-w-0">
            <UBadge color="neutral" variant="subtle" class="max-w-full break-all">
              {{ participant }}
            </UBadge>
          </li>
        </ul>
      </div>

      <!-- `text-muted`, а не `text-dimmed`: последний даёт 2.62:1 на фоне
           карточки против нормы 4.5:1, а это содержательная строка. -->
      <p v-else class="text-sm text-muted">Без участников</p>
    </div>

    <!-- Заглушка повторяет геометрию карточки: когда придут данные, блок с
         файлами не должен подпрыгнуть.

         `aria-hidden` на обёртке, а не на самих `USkeleton`: каждый из них
         рендерит `role="alert"` с `aria-live` и `aria-label="loading"`, и
         четыре заглушки дали бы четыре живых региона с чужим английским
         словом. О загрузке сообщает один `role="status"` на странице. -->
    <div v-else-if="props.pending" aria-hidden="true" class="flex flex-col gap-4">
      <div class="flex flex-col gap-2">
        <USkeleton class="h-8 w-64 sm:w-96" />
        <USkeleton class="h-5 w-48" />
      </div>
      <USkeleton class="h-6 w-56" />
    </div>
  </UCard>
</template>
