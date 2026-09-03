<script setup lang="ts">
// Страница пререндерится (routeRules '/'), поэтому meta уезжают в статический HTML.
useSeoMeta({
  title: 'Video Meetings — видеовстречи в браузере',
  description: 'Групповые видеовстречи без установки приложений.',
  ogTitle: 'Video Meetings',
  ogDescription: 'Групповые видеовстречи без установки приложений.',
})
</script>

<template>
  <section>
    <h1>Видеовстречи в браузере</h1>
    <p>Эта страница пререндерится при сборке — её видят поисковые роботы.</p>
    <NuxtLink to="/app">Перейти в кабинет</NuxtLink>
  </section>
</template>
