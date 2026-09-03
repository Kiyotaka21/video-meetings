// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',

  devtools: { enabled: true },

  css: ['~/assets/css/main.css'],

  devServer: {
    port: 5173,
  },

  runtimeConfig: {
    public: {
      // Переопределяется переменной NUXT_PUBLIC_API_URL.
      apiUrl: 'http://localhost:3000',
    },
  },

  // Гибридный рендеринг: публичные страницы отдаются статикой ради SEO,
  // приватные и WebRTC-маршруты живут только на клиенте.
  routeRules: {
    '/': { prerender: true },
    '/pricing': { prerender: true },
    '/blog/**': { isr: 3600 },
    '/room/**': { ssr: false },
    '/app/**': { ssr: false },
  },

  typescript: {
    strict: true,
    typeCheck: false,
  },
})
