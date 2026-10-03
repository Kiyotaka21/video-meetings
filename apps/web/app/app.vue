<script setup lang="ts">
// Свои строки Nuxt UI — «Закрыть» у тоста, «загрузка» у скелетона, подписи
// скринридеру у диалогов — иначе английские посреди русского интерфейса.
import { ru } from '@nuxt/ui/locale'
</script>

<template>
  <UApp :locale="ru">
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </UApp>
</template>
