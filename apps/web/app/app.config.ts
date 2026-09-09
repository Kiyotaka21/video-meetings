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
  },
})
