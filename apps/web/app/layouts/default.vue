<script setup lang="ts">
import type { NavigationMenuItem } from '@nuxt/ui'

/**
 * Пункты статичные и публичные, от наличия токена не зависят. Так сделано
 * намеренно: `/pricing`, `/login` и `/register` пререндерятся, и меню, собранное
 * по куке, разошлось бы между статическим HTML (токена при сборке нет) и
 * гидратацией. Кто вошёл и кнопка выхода — на самой странице кабинета.
 */
const items: NavigationMenuItem[] = [
  { label: 'Тарифы', icon: 'i-lucide-tag', to: '/pricing' },
  { label: 'Вход', icon: 'i-lucide-log-in', to: '/login' },
  { label: 'Регистрация', icon: 'i-lucide-user-plus', to: '/register' },
]
</script>

<template>
  <div class="flex min-h-dvh flex-col bg-default text-default">
    <header class="border-b border-default">
      <div class="mx-auto flex h-16 max-w-(--ui-container) items-center gap-4 px-4 sm:px-6">
        <!-- Индикатор фокуса задан руками: у голого `NuxtLink`, в отличие от
             `UButton` и `UNavigationMenu`, своего нет, а логотип — первая
             остановка Tab на каждой странице, и без рамки клавиатурный
             пользователь не видит, где он находится. -->
        <NuxtLink
          to="/"
          class="flex shrink-0 items-center gap-2 rounded-(--ui-radius) font-semibold text-highlighted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          <UIcon name="i-lucide-video" class="size-5 text-primary" />
          Video Meetings
        </NuxtLink>

        <!-- Подписи под sm убраны с экрана, но остаются доступными: три пункта в строку
             не влезают в 360px и раскачивают страницу по горизонтали. -->
        <UNavigationMenu
          :items="items"
          :ui="{ linkLabel: 'max-sm:sr-only' }"
          class="ml-auto min-w-0"
        />

        <UColorModeButton class="shrink-0" />
      </div>
    </header>

    <main class="mx-auto w-full max-w-(--ui-container) flex-1 px-4 py-10 sm:px-6">
      <slot />
    </main>

    <footer class="border-t border-default">
      <div class="mx-auto max-w-(--ui-container) px-4 py-6 text-sm text-muted sm:px-6">
        Video Meetings
      </div>
    </footer>
  </div>
</template>
