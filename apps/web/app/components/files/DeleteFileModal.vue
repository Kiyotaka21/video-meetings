<script setup lang="ts">
interface Props {
  name: string
}

interface Emits {
  /** `true` — удалить; `false` — передумал. Закрытие крестиком или Esc — тоже «нет». */
  close: [confirmed: boolean]
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()
</script>

<template>
  <!-- Открывается через `useOverlay`, и страница ждёт `result` — так
       подтверждение читается как обычный `await`, без флагов «открыт ли
       диалог». Крестика нет (`:close="false"`): первым фокус получает «Отмена»,
       и случайный Enter после открытия файл не удалит. Esc и клик мимо по-прежнему
       закрывают диалог. -->
  <UModal
    title="Удалить файл?"
    :description="`«${props.name}» пропадёт из встречи и с диска. Отменить удаление нельзя.`"
    :close="false"
    :ui="{ footer: 'justify-end' }"
  >
    <template #footer>
      <UButton color="neutral" variant="outline" label="Отмена" @click="emit('close', false)" />
      <UButton color="error" icon="i-lucide-trash-2" label="Удалить" @click="emit('close', true)" />
    </template>
  </UModal>
</template>
