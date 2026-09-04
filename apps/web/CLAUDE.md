# CLAUDE.md — apps/web

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Общие правила монорепозитория — в корневом `CLAUDE.md`. Здесь только фронтенд.

## Стек

Nuxt 4.5 (Vue 3.5, Vite, Nitro). `srcDir` — папка `app/`, как принято в Nuxt 4:
страницы лежат в `app/pages/`, а не в корне воркспейса. Порт 5173.

```bash
bun run --filter @video-meetings/web dev        # или из корня: bun run dev:web
cd apps/web && bun run typecheck                # nuxt typecheck
cd apps/web && bun run build && bun run start   # Nitro-сервер из .output
```

Вёрстка — **Nuxt UI 4** (Reka UI + Tailwind CSS 4 + Tailwind Variants). Scoped CSS и
raw-палитра Tailwind не используются, см. раздел «Дизайн-система».

Тестов нет. Для Nuxt понадобился бы `@nuxt/test-utils` с Vitest.

## Дизайн-система

Правила Nuxt UI, нарушение которых ломает единообразие:

**Только семантические цвета.** `text-default`, `text-muted`, `text-highlighted`,
`bg-default`, `bg-elevated`, `bg-muted`, `border-default`, `border-muted`.
Raw-палитра вида `text-gray-500` или `bg-slate-100` запрещена — она игнорирует
светлую/тёмную тему и смену брендинга.

**Брендинг живёт в `app.config.ts`**, а не в классах по компонентам. Там заданы
`primary`/`secondary`/`neutral` (сейчас indigo/violet/zinc — заготовка, а не
согласованный бренд) и дефолтные иконки. Токены `--ui-radius` и `--ui-container` —
в `app/assets/css/main.css`.

**`UApp` в `app/app.vue` обязателен** и уже стоит. Без него не работают `useToast`,
тултипы и программные оверлеи через `useOverlay`.

**Не добавляй `@nuxt/icon`, `@nuxt/fonts`, `@nuxtjs/color-mode` в `modules`** —
Nuxt UI регистрирует их сам. Настраиваются корневыми ключами `icon`, `fonts`,
`colorMode` в `nuxt.config.ts`.

**Иконки** — формат `i-lucide-<name>`. Коллекция `@iconify-json/lucide` стоит
локально осознанно: `/` и `/pricing` пререндерятся, а тянуть иконки по сети во
время сборки ненадёжно.

**Приоритет переопределений** (побеждает верхнее): проп `ui` или `class` на
инстансе → `app.config.ts` → дефолты темы. Имена слотов компонента смотри в
сгенерированном `.nuxt/ui/<component>.ts`, а не угадывай.

**Одна solid-primary кнопка на экран.** Остальное — `variant="outline"`, `"soft"`,
`"ghost"` с `color="neutral"`. Деструктивные действия — `color="error"`.

В `nuxt.config.ts` включён `ui.experimental.componentDetection` — CSS генерируется
только под использованные компоненты. Для динамических `<component :is>` имена
придётся перечислить массивом, иначе стили вырежет.

Документацию по пропсам и слотам отдаёт MCP-сервер Nuxt UI:

```bash
claude mcp add --transport http nuxt-ui https://ui.nuxt.com/mcp
```

Классы Tailwind сортирует Prettier через `prettier-plugin-tailwindcss`; настройка
лежит в корневом `.prettierrc.json` и через `tailwindStylesheet` указывает на
`apps/web/app/assets/css/main.css` — при переносе CSS-входа поправь и там.

## Главное: routeRules — это SEO-контракт

Гибридный рендеринг в `nuxt.config.ts` — причина, по которой здесь Nuxt, а не SPA
на Vite. Каждый класс маршрутов рендерится по-своему:

| Маршрут    | Режим             | Почему                                    |
| ---------- | ----------------- | ----------------------------------------- |
| `/`        | `prerender: true` | статика в `.output/public`, индексируется |
| `/pricing` | `prerender: true` | то же                                     |
| `/blog/**` | `isr: 3600`       | кэш на час, страниц пока нет              |
| `/room/**` | `ssr: false`      | WebRTC и `getUserMedia` требуют браузера  |
| `/app/**`  | `ssr: false`      | кабинет за авторизацией, SEO не нужен     |

**Каждая новая страница требует решения по routeRules.** Правило простое: публичная
и должна индексироваться — `prerender`; нужны браузерные API или авторизация —
`ssr: false`. Молча добавленная страница унаследует SSR по умолчанию, что для
комнаты со звонком означает падение на серверном рендере.

**`prerender: true` на маршруте без страницы ломает сборку** — пререндер получает
404 и валит `nuxt build`. Правило и страницу заводи вместе.

Проверить, что разделение живо, после `bun run build`:

```bash
ls apps/web/.output/public      # ожидаем index.html и pricing/index.html
```

`/room/**` и `/app/**` в `.output/public` попадать не должны — они отдаются
клиентской оболочкой. Быстрая проверка на запущенном сервере: у `/` в HTML есть
`<h1>`, у `/room/abc` — нет.

## Метаданные

На публичных страницах — `useSeoMeta` с `title` и `description` (уезжают в
пререндеренный HTML). На приватных — `robots: 'noindex'`; вдобавок `public/robots.txt`
закрывает `/app/` и `/room/`. Оба места надо держать согласованными.

## Браузерные API

Всё, что трогает `window`, `navigator.mediaDevices`, WebRTC, живёт либо на маршруте
с `ssr: false`, либо под `import.meta.client` / `onMounted` / `<ClientOnly>`.
На SSR-маршруте обращение к `window` на верхнем уровне `<script setup>` уронит рендер.

## Конфигурация и типы

Адрес API берётся из `useRuntimeConfig().public.apiUrl`, а не из `import.meta.env`.
Переопределяется переменной `NUXT_PUBLIC_API_URL` — Nuxt сопоставляет её с
`runtimeConfig.public.apiUrl` по имени.

Авто-импорты Nuxt (`ref`, `computed`, `useRoute`, `useSeoMeta`, компоненты из
`app/components/`) не надо импортировать вручную. Из-за них в корневом ESLint-конфиге
для `apps/web` выключены два правила:

- `no-undef` — авто-импорты для него не существуют, а реальные опечатки всё равно
  ловит `vue-tsc` по типам из `.nuxt`;
- `vue/multi-word-component-names` для `pages/` и `layouts/` — имена там диктует
  файловый роутинг (`index.vue`, `pricing.vue`).

`tsconfig.json` ссылается на сгенерированные `.nuxt/tsconfig.*.json`, поэтому
**typecheck без `.nuxt` не работает**. Папку создаёт `nuxt prepare`, он же висит в
`postinstall`. Если typecheck жалуется на отсутствующие пути или незнакомые
авто-импорты — первым делом пересобери типы:

```bash
cd apps/web && bun run nuxt prepare
# либо из корня:
bun run --filter @video-meetings/web postinstall
```

## Документация

Полная таблица «что чем тянется» — в корневом `CLAUDE.md`, раздел «Документация
обновляется в том же коммите». Для фронтенда критичны два пункта:

- **Любая новая страница или правка `routeRules`** — обнови таблицу маршрутов в
  разделе «Главное: routeRules — это SEO-контракт» и раздел «Рендеринг во
  фронтенде» в `README.md`. Эта таблица не справочная: она единственное место, где написано,
  какие страницы индексируются, а какие сознательно отданы клиенту. Разошлась с
  `nuxt.config.ts` — и следующая правка SEO будет сделана по неверной картине.
- **Смена палитры, токенов или правил Nuxt UI** — раздел «Дизайн-система» здесь и
  пункт про Nuxt UI в «Тулинге» `README.md`. Сейчас там честно написано, что
  indigo/violet/zinc — заготовка; когда появится настоящий брендинг, эту оговорку
  надо снять.

Подключение UI-библиотеки, замена CSS-входа или переезд `srcDir` задевают ещё и
корневой `CLAUDE.md` (размещение зависимостей, `tailwindStylesheet` в
`.prettierrc.json`).
