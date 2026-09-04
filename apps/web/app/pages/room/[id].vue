<script setup lang="ts">
// routeRules '/room/**' -> ssr: false: здесь живут getUserMedia и WebRTC,
// которым нужен настоящий браузер.
const route = useRoute()
const roomId = computed(() => String(route.params.id))

useSeoMeta({ title: () => `Комната ${roomId.value}`, robots: 'noindex' })
</script>

<template>
  <div class="flex flex-col gap-6">
    <div class="flex items-center gap-3">
      <UIcon name="i-lucide-video" class="size-6 text-primary" />
      <h1 class="text-2xl font-semibold tracking-tight text-highlighted">Комната {{ roomId }}</h1>
    </div>

    <UAlert
      icon="i-lucide-construction"
      color="warning"
      variant="subtle"
      title="Заготовка"
      description="Место под WebRTC. Маршрут отключён от SSR, поэтому здесь можно обращаться к getUserMedia."
    />
  </div>
</template>
