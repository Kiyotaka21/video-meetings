<script setup lang="ts">
// routeRules '/app/**' -> ssr: false, страница рендерится только в браузере.
const { apiUrl } = useRuntimeConfig().public

useSeoMeta({ title: 'Кабинет — Video Meetings', robots: 'noindex' })
</script>

<template>
  <div class="flex flex-col gap-6">
    <div class="flex flex-col gap-2">
      <h1 class="text-3xl font-semibold tracking-tight text-highlighted">Кабинет</h1>
      <p class="text-muted">Только клиентский рендеринг — SEO здесь не нужен.</p>
    </div>

    <UAlert
      icon="i-lucide-plug"
      color="neutral"
      variant="subtle"
      title="Адрес API"
      :description="apiUrl"
    />
  </div>
</template>
