<script setup lang="ts">
useSeoMeta({
  title: 'Тарифы — Video Meetings',
  description: 'Стоимость планов Video Meetings.',
})

const plans = [
  { name: 'Бесплатный', price: '0 ₽', hint: 'до 4 участников', highlight: false },
  { name: 'Команда', price: '990 ₽', hint: 'до 50 участников', highlight: true },
  { name: 'Бизнес', price: 'по запросу', hint: 'без ограничений', highlight: false },
]
</script>

<template>
  <div class="flex flex-col gap-8">
    <div class="flex flex-col gap-2">
      <h1 class="text-3xl font-semibold tracking-tight text-highlighted">Тарифы</h1>
      <p class="text-muted">Пререндеренная страница для SEO. Цены — заготовка.</p>
    </div>

    <div class="grid gap-4 sm:grid-cols-3">
      <UCard v-for="plan in plans" :key="plan.name" :variant="plan.highlight ? 'solid' : 'outline'">
        <template #header>
          <div class="flex items-center justify-between gap-2">
            <span class="font-medium">{{ plan.name }}</span>
            <UBadge v-if="plan.highlight" color="primary" variant="subtle" label="Популярный" />
          </div>
        </template>

        <div class="flex flex-col gap-1">
          <span class="text-2xl font-semibold">{{ plan.price }}</span>
          <span class="text-sm opacity-75">{{ plan.hint }}</span>
        </div>
      </UCard>
    </div>
  </div>
</template>
