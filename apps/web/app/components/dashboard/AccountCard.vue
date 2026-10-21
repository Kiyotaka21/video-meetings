<script setup lang="ts">
interface Props {
  /** Адрес из `/auth/me`. `undefined` — либо ещё не пришёл, либо запрос отказал. */
  email?: string
  /** Имя из `/auth/me`. `null` — не задано, тогда карточка показывает адрес, как раньше. */
  name?: string | null
  /**
   * Запрос ещё в полёте. Отличать от «не пришёл вовсе» обязательно: без этого
   * флага упавший `/auth/me` оставлял карточку в состоянии загрузки навсегда.
   */
  pending?: boolean
  /** Выход в процессе: блокирует кнопку и показывает индикатор. */
  loading?: boolean
}

interface Emits {
  logout: []
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()
</script>

<template>
  <UCard>
    <div class="flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
      <!-- Имя — крупнее адреса, адрес — под ним. `text-base/5`: строка 20px, как
           у `text-sm`, — карточка с именем той же высоты, что без него и что
           заглушка, и список встреч под ней не прыгает. `wrap-anywhere`, а не
           `break-words`: на 360px имя из 50 букв без пробела иначе распирало бы
           карточку — `overflow-wrap: anywhere` уменьшает и min-content. Имя
           выводится интерполяцией, так что `<b>` в нём — текст, а не разметка. -->
      <UUser
        v-if="props.email && props.name"
        :name="props.name"
        :description="props.email"
        :avatar="{ icon: 'i-lucide-user' }"
        size="lg"
        class="min-w-0"
        :ui="{ name: 'text-base/5 wrap-anywhere', description: 'break-all' }"
      />

      <UUser
        v-else-if="props.email"
        :name="props.email"
        description="Аккаунт организатора"
        :avatar="{ icon: 'i-lucide-user' }"
        size="lg"
        class="min-w-0"
        :ui="{ name: 'break-all' }"
      />

      <!-- Заглушка той же высоты, что и `UUser`: иначе появление адреса сдвигало
           бы список встреч вниз.

           `aria-hidden` на обёртке, а не на самих `USkeleton`: каждый из них
           рендерит `role="alert"` с `aria-live="polite"` и `aria-label="loading"`,
           и три таких в одной карточке — три конкурирующих живых региона,
           объявляющих чужое английское слово. Скрытый предок выключает всё
           поддерево разом; о загрузке сообщает один `role="status"` на странице. -->
      <div v-else-if="props.pending" aria-hidden="true" class="flex min-w-0 items-center gap-3">
        <USkeleton class="size-10 shrink-0 rounded-full" />
        <div class="flex flex-col gap-2">
          <USkeleton class="h-4 w-40 sm:w-56" />
          <USkeleton class="h-3 w-32" />
        </div>
      </div>

      <!-- Запрос отказал: токен есть, значит вход состоялся, а вот адрес взять
           неоткуда. Честнее сказать это, чем крутить заглушку. -->
      <UUser
        v-else
        name="Вы вошли"
        description="Адрес не удалось загрузить"
        :avatar="{ icon: 'i-lucide-user' }"
        size="lg"
        class="min-w-0"
      />

      <div class="flex flex-wrap gap-2">
        <UButton
          to="/profile"
          color="neutral"
          variant="outline"
          icon="i-lucide-user-pen"
          label="Профиль"
        />

        <UButton
          color="neutral"
          variant="outline"
          icon="i-lucide-log-out"
          label="Выйти"
          :loading="props.loading"
          @click="emit('logout')"
        />
      </div>
    </div>
  </UCard>
</template>
