<script setup lang="ts">
import type { NavigationMenuItem } from '@nuxt/ui'

const items: NavigationMenuItem[] = [
  { label: 'Тарифы', icon: 'i-lucide-tag', to: '/pricing' },
  { label: 'Кабинет', icon: 'i-lucide-layout-dashboard', to: '/app' },
]
</script>

<template>
  <div class="flex min-h-dvh flex-col bg-default text-default">
    <header class="border-b border-default">
      <div class="mx-auto flex h-16 max-w-(--ui-container) items-center gap-4 px-4 sm:px-6">
        <NuxtLink to="/" class="flex items-center gap-2 font-semibold text-highlighted">
          <UIcon name="i-lucide-video" class="size-5 text-primary" />
          Video Meetings
        </NuxtLink>

        <UNavigationMenu :items="items" class="ml-auto" />

        <UColorModeButton />
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
