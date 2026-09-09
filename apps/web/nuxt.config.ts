// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  // @nuxt/icon, @nuxt/fonts и @nuxtjs/color-mode Nuxt UI регистрирует сам —
  // добавлять их сюда не нужно.
  modules: ['@nuxt/ui'],

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
    // Кабинет: доступен только с токеном, поэтому индексировать нечего.
    // `X-Robots-Tag` заголовком, а не строкой в robots.txt: `Disallow: /` закрыл
    // бы вместе с корнем и все публичные страницы, а `Disallow: /$` — расширение
    // Google, а не стандарт.
    '/': { ssr: false, headers: { 'x-robots-tag': 'noindex' } },
    '/pricing': { prerender: true },
    // Публичные точки входа: формы гидратируются, но HTML отдаётся статикой.
    '/login': { prerender: true },
    '/register': { prerender: true },
    '/blog/**': { isr: 3600 },
    '/room/**': { ssr: false },
    // Кабинет переехал с `/app` на `/`; правило держим, чтобы сохранённые
    // ссылки и закладки не отдавали 404.
    '/app': { redirect: '/' },
    '/app/**': { redirect: '/' },
  },

  typescript: {
    strict: true,
    typeCheck: false,
  },

  ui: {
    experimental: {
      // Генерировать CSS только под используемые компоненты.
      componentDetection: true,
    },
  },
})
