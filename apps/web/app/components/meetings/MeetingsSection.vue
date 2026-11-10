<script setup lang="ts">
import type { Meeting } from '~/types/meetings'
import { MEETING_FORMS, plural } from '~/utils/meetings'

interface Props {
  title: string
  icon: string
  meetings: Meeting[]
  /**
   * Сколько встреч во всей выборке, а не загружено: api отдаёт список
   * страницами, и счётчик у заголовка не должен расти с каждой догрузкой. Не
   * задан — счётчик по показанным (так у «Последних встреч», где показаны ровно
   * несколько свежих).
   */
  total?: number
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
  /** У api есть следующая страница — показать кнопку «Показать ещё». */
  hasMore?: boolean
  loadingMore?: boolean
  /** Отказ догрузки: показывается под кнопкой, уже загруженное остаётся на месте. */
  moreFailure?: string | null
}

const props = defineProps<Props>()

const emit = defineEmits<{ more: [] }>()

/** Счётчик со словом, а не голое число: «3» скринридер объявит без контекста. */
const countLabel = computed(() => plural(props.total ?? props.meetings.length, MEETING_FORMS))

const list = useTemplateRef<HTMLUListElement>('list')
const moreRow = useTemplateRef<HTMLDivElement>('moreRow')

/**
 * Строка «Показано N из M» появляется с первой страницей, у которой есть
 * продолжение, и остаётся после последней: исчезни она вместе с кнопкой,
 * скринридер не услышал бы, что догружено всё.
 */
const requestedMore = shallowRef(false)

let lengthBeforeMore = 0
let focusWasOnButton = false

const onMore = () => {
  requestedMore.value = true
  lengthBeforeMore = props.meetings.length
  focusWasOnButton = moreRow.value?.contains(document.activeElement) ?? false
  emit('more')
}

/**
 * Пока страница грузится, кнопка выключена, и фокус с неё уезжает в `body`.
 * По окончании он встаёт на первую из новых встреч — с неё и продолжается
 * чтение, а Tab дальше снова дойдёт до кнопки; на отказе — обратно на кнопку,
 * к тексту отказа под ней. Если фокус за это время ушёл сам — не трогаем.
 *
 * `flush: 'post'`: новые строки и сама кнопка к этому моменту уже в DOM.
 */
watch(
  () => props.loadingMore,
  (loading, wasLoading) => {
    if (loading || !wasLoading) {
      return
    }

    const shouldRestore =
      focusWasOnButton && (!document.activeElement || document.activeElement === document.body)

    focusWasOnButton = false

    if (!shouldRestore) {
      return
    }

    const firstNew = props.moreFailure
      ? null
      : list.value?.children.item(lengthBeforeMore)?.querySelector<HTMLElement>('a')

    ;(firstNew ?? moreRow.value?.querySelector<HTMLElement>('button'))?.focus()
  },
  { flush: 'post' },
)
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
      <ul ref="list" class="divide-y divide-default">
        <MeetingsMeetingItem
          v-for="meeting in props.meetings"
          :key="meeting.id"
          :meeting="meeting"
        />
      </ul>
    </UCard>

    <UEmpty v-else-if="props.empty" :icon="props.icon" :description="props.empty" />

    <!-- Кнопка и счётчик над отказом, а не под ним: появившийся алерт не
         сдвигает кнопку из-под указателя, если догрузку повторяют кликом. -->
    <div
      v-if="props.hasMore || requestedMore"
      ref="moreRow"
      class="flex flex-wrap items-center gap-x-4 gap-y-2"
    >
      <UButton
        v-if="props.hasMore"
        color="neutral"
        variant="outline"
        icon="i-lucide-chevrons-down"
        label="Показать ещё"
        :loading="props.loadingMore"
        @click="onMore"
      />

      <p v-if="props.total !== undefined" role="status" class="text-sm text-muted">
        Показано {{ props.meetings.length }} из {{ props.total }}
      </p>
    </div>

    <!-- Страница сбрасывает отказ в начале каждой попытки, поэтому алерт
         монтируется заново, и тот же текст второй раз подряд тоже объявляется. -->
    <UAlert
      v-if="props.moreFailure"
      role="alert"
      color="error"
      variant="subtle"
      icon="i-lucide-triangle-alert"
      title="Следующие встречи не загрузились"
      :description="props.moreFailure"
    />
  </section>
</template>
