# video-meetings

Монорепозиторий на **Bun workspaces** с двумя приложениями:

| Пакет                 | Путь       | Стек                          | Порт |
| --------------------- | ---------- | ----------------------------- | ---- |
| `@video-meetings/web` | `apps/web` | Nuxt 4 + Nuxt UI (Tailwind 4) | 5173 |
| `@video-meetings/api` | `apps/api` | Elysia.js + Bun + TypeScript  | 3000 |

`packages/` зарезервирован под общие библиотеки (пока пуст).

## Требования

- [Bun](https://bun.sh) >= 1.2
- Node.js >= 20.19 (нужен Vite/Nitro)

## Установка

```bash
bun install            # postinstall сам выполнит nuxt prepare
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
```

## Скрипты (корень)

| Команда                | Что делает                               |
| ---------------------- | ---------------------------------------- |
| `bun run dev`          | Поднимает web и api параллельно          |
| `bun run dev:web`      | Только фронтенд                          |
| `bun run dev:api`      | Только бэкенд (`--watch`)                |
| `bun run build`        | Сборка обоих приложений                  |
| `bun run start:web`    | Nitro-сервер из `.output`                |
| `bun run start:api`    | Запуск api в production-режиме           |
| `bun run typecheck`    | `nuxt typecheck` / `tsc` по воркспейсам  |
| `bun run lint`         | ESLint по всему репозиторию              |
| `bun run lint:fix`     | ESLint с автофиксом                      |
| `bun run format`       | Prettier `--write`                       |
| `bun run format:check` | Prettier `--check`                       |
| `bun run check`        | format:check + lint + typecheck (для CI) |
| `bun run clean`        | Удаляет `node_modules`, `.nuxt`, сборки  |

## Рендеринг во фронтенде

Nuxt настроен на гибридный рендеринг — `routeRules` в `apps/web/nuxt.config.ts`:

| Маршрут    | Режим             | Зачем                                              |
| ---------- | ----------------- | -------------------------------------------------- |
| `/`        | `prerender: true` | Статика в `.output/public` — индексируется         |
| `/pricing` | `prerender: true` | То же                                              |
| `/blog/**` | `isr: 3600`       | Кэш на час, страниц пока нет                       |
| `/room/**` | `ssr: false`      | WebRTC и `getUserMedia` требуют реального браузера |
| `/app/**`  | `ssr: false`      | Кабинет за авторизацией, SEO не нужен              |

Проверить после `bun run build:`

```bash
ls apps/web/.output/public          # index.html и pricing/index.html
grep -o '<title>[^<]*' apps/web/.output/public/index.html
```

`/room/**` и `/app/**` в `.output/public` не попадают — это ожидаемо, они
отдаются клиентской оболочкой.

## Структура

```
.
├── apps
│   ├── api                 # Elysia.js
│   │   └── src
│   │       ├── config      # env и конфигурация
│   │       ├── modules     # доменные модули (плагины Elysia)
│   │       ├── app.ts      # сборка приложения
│   │       └── index.ts    # точка входа / listen
│   └── web                 # Nuxt 4
│       ├── app             # srcDir Nuxt 4
│       │   ├── assets/css
│       │   ├── components
│       │   ├── layouts
│       │   ├── pages       # файловый роутинг
│       │   └── app.vue
│       ├── public          # robots.txt и статика
│       └── nuxt.config.ts
├── packages                # общие пакеты (пусто)
├── eslint.config.js        # общий flat-config для web и api
├── tsconfig.base.json      # общие compilerOptions
└── package.json            # workspaces + корневые скрипты
```

## Тулинг

- **ESLint 10** (flat config) — единый `eslint.config.js` в корне: `@eslint/js`,
  `typescript-eslint`, `eslint-plugin-vue`, `eslint-config-prettier`. Для `apps/web`
  отключён `no-undef` (авто-импорты Nuxt ловит `vue-tsc` по типам из `.nuxt`)
  и `vue/multi-word-component-names` для `pages/` и `layouts/`.
- **Prettier 3** — `.prettierrc.json`, форматирование отделено от линтинга. Файлы,
  которые пишет Claude Code, форматируются автоматически хуком из
  `.claude/settings.json` — детали в корневом `CLAUDE.md`.
- **Nuxt UI 4** — компоненты на Reka UI и Tailwind CSS 4. Брендинг в
  `apps/web/app.config.ts`, токены в `apps/web/app/assets/css/main.css`. В разметке
  только семантические цвета (`text-muted`, `bg-elevated`), не raw-палитра Tailwind.
  Классы сортирует `prettier-plugin-tailwindcss`.
- **Elysia-плагины** — `@elysiajs/cors` (origin'ы из `CORS_ORIGINS`, `credentials: true`)
  и `@elysiajs/openapi` (Scalar UI на `/docs`, спека на `/docs/json`; выключен при
  `NODE_ENV=production`).
- **TypeScript 5.9** — общий `tsconfig.base.json`; у `web` project references на
  сгенерированные `.nuxt/tsconfig.*.json`, у `api` — `types: ["bun"]`.

## Проверка API

```bash
bun run dev:api
curl http://localhost:3000/health
# {"status":"ok","uptime":0.1,"timestamp":"..."}

# OpenAPI (Scalar UI, только вне production)
open http://localhost:3000/docs
```
