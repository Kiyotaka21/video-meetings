<script setup lang="ts">
// Страница пререндерится (routeRules '/'), поэтому meta уезжают в статический HTML.
useSeoMeta({
  title: 'Video Meetings — видеовстречи в браузере',
  description: 'Групповые видеовстречи без установки приложений.',
  ogTitle: 'Video Meetings',
  ogDescription: 'Групповые видеовстречи без установки приложений.',
})

const features = [
  {
    title: 'Прямо в браузере',
    description: 'WebRTC без плагинов и установки клиента.',
    icon: 'i-lucide-globe',
  },
  {
    title: 'Ссылка на комнату',
    description: 'Участник открывает ссылку и сразу в звонке.',
    icon: 'i-lucide-link',
  },
  {
    title: 'Без регистрации',
    description: 'Гостям не нужен аккаунт, чтобы присоединиться.',
    icon: 'i-lucide-user-check',
  },
]
</script>

<template>
  <div class="flex flex-col gap-10">
    <section class="flex flex-col items-start gap-4">
      <UBadge color="primary" variant="subtle" label="Ранняя версия" />

      <h1 class="text-4xl font-semibold tracking-tight text-highlighted sm:text-5xl">
        Видеовстречи в браузере
      </h1>

      <p class="max-w-2xl text-lg text-muted">
        Без установки приложений и регистрации участников. Эта страница пререндерится при сборке —
        её видят поисковые роботы.
      </p>

      <div class="flex flex-wrap items-center gap-3">
        <UButton to="/app" icon="i-lucide-arrow-right" trailing size="lg" label="В кабинет" />
        <UButton
          to="/pricing"
          color="neutral"
          variant="outline"
          size="lg"
          label="Смотреть тарифы"
        />
      </div>
    </section>

    <section class="grid gap-4 sm:grid-cols-3">
      <UCard v-for="feature in features" :key="feature.title">
        <template #header>
          <div class="flex items-center gap-2">
            <UIcon :name="feature.icon" class="size-5 text-primary" />
            <span class="font-medium text-highlighted">{{ feature.title }}</span>
          </div>
        </template>
        <p class="text-sm text-muted">{{ feature.description }}</p>
      </UCard>
    </section>
  </div>
</template>
