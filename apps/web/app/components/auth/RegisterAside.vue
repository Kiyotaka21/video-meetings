<script setup lang="ts">
const benefits = [
  {
    icon: 'i-lucide-link',
    title: 'Комната — это ссылка',
    description: 'Создаёте встречу и отправляете ссылку. Участникам аккаунт не нужен.',
  },
  {
    icon: 'i-lucide-shield-check',
    title: 'Пароль не хранится',
    description: 'В базу уезжает argon2id-хеш, а сессию подтверждает подписанный токен.',
  },
  {
    icon: 'i-lucide-monitor-smartphone',
    title: 'Ничего не устанавливать',
    description: 'WebRTC работает прямо в браузере — и на ноутбуке, и на телефоне.',
  },
]
</script>

<template>
  <section class="flex flex-col gap-8">
    <div class="flex flex-col items-start gap-4">
      <UBadge color="primary" variant="subtle" icon="i-lucide-sparkles" label="Ранняя версия" />

      <h1 class="text-4xl font-semibold tracking-tight text-highlighted sm:text-5xl">
        Аккаунт нужен только организатору
      </h1>

      <p class="max-w-xl text-lg text-muted">
        Регистрация занимает один экран: адрес почты и пароль. Дальше открывается кабинет со
        встречами.
      </p>
    </div>

    <ul class="flex flex-col gap-5">
      <li v-for="benefit in benefits" :key="benefit.title" class="flex items-start gap-4">
        <span
          class="flex size-10 shrink-0 items-center justify-center rounded-(--ui-radius) bg-primary/10 text-primary"
        >
          <UIcon :name="benefit.icon" class="size-5" />
        </span>

        <div class="flex flex-col gap-1">
          <span class="font-medium text-highlighted">{{ benefit.title }}</span>
          <span class="text-sm text-muted">{{ benefit.description }}</span>
        </div>
      </li>
    </ul>
  </section>
</template>
