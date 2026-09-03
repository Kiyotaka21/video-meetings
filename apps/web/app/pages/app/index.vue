<script setup lang="ts">
// routeRules '/app/**' -> ssr: false, страница рендерится только в браузере.
const { apiUrl } = useRuntimeConfig().public

useSeoMeta({ title: 'Кабинет — Video Meetings', robots: 'noindex' })
</script>

<template>
  <section>
    <h1>Кабинет</h1>
    <p>Только клиентский рендеринг. API: {{ apiUrl }}</p>
  </section>
</template>
