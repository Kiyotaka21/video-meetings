<script setup lang="ts">
interface Emits {
  /** `true` — удалить; `false` — передумал. Esc и клик мимо — тоже «нет». */
  close: [confirmed: boolean]
}

const emit = defineEmits<Emits>()
</script>

<template>
  <!-- Устроен как `FilesDeleteFileModal`: открывается через `useOverlay`, и
       страница ждёт `result` обычным `await`. Крестика нет (`:close="false"`),
       поэтому первым фокус получает «Отмена», и случайный Enter после открытия
       аватар не удалит. -->
  <UModal
    title="Удалить аватар?"
    description="Вместо фото снова будет иконка — и здесь, и в кабинете. Вернуть его можно, только загрузив заново."
    :close="false"
    :ui="{ footer: 'justify-end' }"
  >
    <template #footer>
      <UButton color="neutral" variant="outline" label="Отмена" @click="emit('close', false)" />
      <UButton color="error" icon="i-lucide-trash-2" label="Удалить" @click="emit('close', true)" />
    </template>
  </UModal>
</template>
