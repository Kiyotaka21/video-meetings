// Брендинг и глобальные дефолты Nuxt UI.
// Правится здесь, а не классами по компонентам.
export default defineAppConfig({
  ui: {
    colors: {
      primary: 'indigo',
      secondary: 'violet',
      neutral: 'zinc',
    },
    icons: {
      loading: 'i-lucide-loader-circle',
    },
    button: {
      compoundVariants: [
        // Дефолтный hover solid-кнопки — `bg-primary/75`: фон светлеет к фону
        // страницы, и текст на нём проваливается до 3.01:1 в светлой теме и
        // 3.75:1 в тёмной при норме 4.5:1 (замер canvas). Соседний оттенок той же
        // палитры держит контраст: 600 в светлой — 6.46:1, 300 в тёмной — 8.82:1.
        {
          color: 'primary',
          variant: 'solid',
          class:
            'hover:bg-(--ui-color-primary-600) active:bg-(--ui-color-primary-600) dark:hover:bg-(--ui-color-primary-300) dark:active:bg-(--ui-color-primary-300)',
        },
        // Ghost-кнопка ошибки («Удалить») на hover подкладывает `bg-error/10`, и в
        // светлой теме красный текст на розовой подложке — 3.97:1. Текст темнеет
        // до 700-го оттенка — 5.4:1; в тёмной теме дефолт и так даёт 5.36:1.
        {
          color: 'error',
          variant: 'ghost',
          class:
            'hover:text-(--ui-color-error-700) active:text-(--ui-color-error-700) dark:hover:text-error dark:active:text-error',
        },
      ],
    },
  },
})
