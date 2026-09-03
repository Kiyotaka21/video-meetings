<template>
  <div class="layout">
    <header class="layout__header">
      <NuxtLink to="/" class="layout__brand">Video Meetings</NuxtLink>
      <nav class="layout__nav">
        <NuxtLink to="/pricing">Тарифы</NuxtLink>
        <NuxtLink to="/app">Кабинет</NuxtLink>
      </nav>
    </header>

    <main class="layout__main">
      <slot />
    </main>
  </div>
</template>

<style scoped>
.layout {
  display: flex;
  flex-direction: column;
  min-height: 100dvh;
}

.layout__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 1rem 1.5rem;
  border-bottom: 1px solid color-mix(in srgb, currentColor 15%, transparent);
}

.layout__brand {
  font-weight: 600;
}

.layout__nav {
  display: flex;
  gap: 1rem;
}

.layout__main {
  flex: 1;
  padding: 2rem 1.5rem;
}
</style>
