<script setup lang="ts">
// routeRules '/room/**' -> ssr: false: здесь живут getUserMedia и WebRTC,
// которым нужен настоящий браузер.
const route = useRoute()
const roomId = computed(() => String(route.params.id))

useSeoMeta({ title: () => `Комната ${roomId.value}`, robots: 'noindex' })
</script>

<template>
  <section>
    <h1>Комната {{ roomId }}</h1>
    <p>Клиентский рендеринг, место под WebRTC.</p>
  </section>
</template>
