# video-meetings

Монорепозиторий на **Bun workspaces** с двумя приложениями:

| Пакет                 | Путь       | Стек                          | Порт |
| --------------------- | ---------- | ----------------------------- | ---- |
| `@video-meetings/web` | `apps/web` | Nuxt 4 + Nuxt UI (Tailwind 4) | 5173 |
| `@video-meetings/api` | `apps/api` | Elysia.js + Bun + Prisma 7    | 3000 |

`packages/` зарезервирован под общие библиотеки (пока пуст).

## Требования

- [Bun](https://bun.sh) >= 1.2
- Node.js >= 20.19 (нужен Vite/Nitro)
- Docker с Compose v2 — под Postgres (`docker compose version` должен отвечать)

## Установка

```bash
bun install            # postinstall выполнит nuxt prepare и prisma generate
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
bun run db:up          # Postgres в контейнере, дефолты зашиты в docker-compose.yml
bun run db:migrate     # накатить схему (таблица users)
```

В `apps/api/.env` обязательно задать свой `JWT_SECRET` — дефолта у него нет, без
него api не стартует. Сгенерировать: `openssl rand -base64 48`.

Корневой `.env` нужен только чтобы переопределить креды или порт Postgres —
смотри `.env.example` в корне.

## Скрипты (корень)

| Команда                | Что делает                               |
| ---------------------- | ---------------------------------------- |
| `bun run dev`          | Поднимает web и api параллельно          |
| `bun run dev:web`      | Только фронтенд                          |
| `bun run dev:api`      | Только бэкенд (`--watch`)                |
| `bun run build`        | Сборка обоих приложений                  |
| `bun run start:web`    | Nitro-сервер из `.output`                |
| `bun run start:api`    | Запуск api в production-режиме           |
| `bun run db:up`        | Поднимает Postgres и ждёт healthcheck    |
| `bun run db:down`      | Останавливает контейнер (том остаётся)   |
| `bun run db:logs`      | Логи Postgres в режиме `-f`              |
| `bun run db:migrate`   | `prisma migrate dev` — схема и миграции  |
| `bun run db:generate`  | `prisma generate` — пересборка клиента   |
| `bun run typecheck`    | `nuxt typecheck` / `tsc` по воркспейсам  |
| `bun run test`         | `bun test` в `apps/api` (нужна база)     |
| `bun run lint`         | ESLint по всему репозиторию              |
| `bun run lint:fix`     | ESLint с автофиксом                      |
| `bun run format`       | Prettier `--write`                       |
| `bun run format:check` | Prettier `--check`                       |
| `bun run check`        | format:check + lint + typecheck (для CI) |
| `bun run clean`        | Удаляет `node_modules`, `.nuxt`, сборки  |

## База данных

Postgres 18 (`postgres:18-alpine`) в контейнере из корневого `docker-compose.yml`.
Сами приложения запускаются нативно через `bun run dev` — в Docker живёт только
состояние.

| Параметр              | Значение по умолчанию               |
| --------------------- | ----------------------------------- |
| хост:порт             | `localhost:5432`                    |
| база                  | `video_meetings`                    |
| пользователь / пароль | `video_meetings` / `video_meetings` |

```
postgresql://video_meetings:video_meetings@localhost:5432/video_meetings
```

```bash
bun run db:up                                            # поднять и дождаться готовности
docker compose exec postgres psql -U video_meetings -d video_meetings   # psql внутри контейнера
docker compose down -v                                   # снести вместе с данными
```

Данные лежат в томе `video-meetings_postgres-data`, поэтому `db:down` и
перезапуск их не теряют — стирает только `down -v`.

Схемой управляет **Prisma 7** из `apps/api`: модели в `apps/api/prisma/schema.prisma`,
миграции в `apps/api/prisma/migrations/` (коммитятся), строка подключения — в
`apps/api/.env`.

| Таблица    | Что лежит                                                                          |
| ---------- | ---------------------------------------------------------------------------------- |
| `users`    | `id`, `email` (unique), `password_hash`, `created_at`, `updated_at`                |
| `meetings` | `id`, `title`, `date`, `participants` (`text[]`), `owner_id` → `users.id`, отметки |

```bash
bun run db:migrate                     # создать и применить миграцию по схеме
bun run db:generate                    # пересобрать клиент после правки схемы
bun run --filter @video-meetings/api db:studio   # Prisma Studio
```

Сгенерированный клиент лежит в `apps/api/generated/` и в git не попадает — его
восстанавливает `bun install` (через `postinstall`) или `bun run db:generate`.

## Тесты

Раннер — встроенный `bun test`. Пока тесты есть только у `api`, лежат в
`apps/api/tests/` и бьют по приложению через `app.handle` — без открытия порта,
но по всему конвейеру Elysia.

```bash
bun run db:up      # тесты ходят в настоящую базу, моков нет
bun run db:migrate # схема должна быть накатана
bun run test       # алиас на bun run --filter @video-meetings/api test
bun run --filter @video-meetings/api test:watch
```

`bun run check` тесты не запускает — он должен работать без Docker.

Проект разрабатывается от тестов: сначала контракт в виде падающего теста, потом
реализация. Тесты в `apps/api/tests/` — исполняемая спецификация API:

| Файл                   | Что фиксирует                                                                      |
| ---------------------- | ---------------------------------------------------------------------------------- |
| `auth.e2e.test.ts`     | регистрация, логин и `/auth/me`: коды ответов, нормализация e-mail, содержимое JWT |
| `meetings.e2e.test.ts` | встречи: guard по токену, изоляция между пользователями, формат дат                |

Тесты не чистят за собой базу, а генерируют уникальные адреса, так что `users` и
`meetings` после прогонов заполняются мусором. Вычистить: `docker compose down -v`
и заново `bun run db:up && bun run db:migrate`.

## Рендеринг во фронтенде

Nuxt настроен на гибридный рендеринг — `routeRules` в `apps/web/nuxt.config.ts`:

| Маршрут     | Режим             | Зачем                                               |
| ----------- | ----------------- | --------------------------------------------------- |
| `/`         | `prerender: true` | Статика в `.output/public` — индексируется          |
| `/pricing`  | `prerender: true` | То же                                               |
| `/register` | `prerender: true` | Регистрация: публичный вход, HTML отдаётся статикой |
| `/blog/**`  | `isr: 3600`       | Кэш на час, страниц пока нет                        |
| `/room/**`  | `ssr: false`      | WebRTC и `getUserMedia` требуют реального браузера  |
| `/app/**`   | `ssr: false`      | Кабинет за авторизацией, SEO не нужен               |

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
│   │   ├── src
│   │   │   ├── config      # env и конфигурация
│   │   │   ├── db          # инстанс PrismaClient
│   │   │   ├── modules     # доменные модули (плагины Elysia)
│   │   │   ├── app.ts      # сборка приложения
│   │   │   └── index.ts    # точка входа / listen
│   │   ├── prisma          # schema.prisma и migrations/
│   │   ├── tests           # bun test: helpers/ и *.e2e.test.ts
│   │   ├── bunfig.toml     # preload для тестов
│   │   └── prisma.config.ts
│   └── web                 # Nuxt 4
│       ├── app             # srcDir Nuxt 4
│       │   ├── assets/css
│       │   ├── components  # auth/ — форма регистрации
│       │   ├── composables # useAuth: токен и запросы к /auth
│       │   ├── layouts
│       │   ├── pages       # файловый роутинг
│       │   ├── types       # контракт api на клиенте
│       │   ├── utils       # валидация и разбор ошибок
│       │   └── app.vue
│       ├── public          # robots.txt и статика
│       └── nuxt.config.ts
├── packages                # общие пакеты (пусто)
├── docker-compose.yml      # Postgres для локальной разработки
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
  `apps/web/app/app.config.ts`, токены в `apps/web/app/assets/css/main.css`. В разметке
  только семантические цвета (`text-muted`, `bg-elevated`), не raw-палитра Tailwind.
  Классы сортирует `prettier-plugin-tailwindcss`.
- **Elysia-плагины** — `@elysiajs/cors` (origin'ы из `CORS_ORIGINS`, `credentials: true`),
  `@elysiajs/openapi` (Scalar UI на `/docs`, спека на `/docs/json`; выключен при
  `NODE_ENV=production`) и `@elysiajs/jwt` (подпись HS256 секретом `JWT_SECRET`,
  срок жизни из `JWT_EXPIRES_IN`).
- **Prisma 7** — ORM для Postgres. У семёрки нет Rust-движка, поэтому клиент ходит в
  базу через драйверный адаптер `@prisma/adapter-pg`, а `DATABASE_URL` задаётся в
  `apps/api/prisma.config.ts`, а не в блоке `datasource`. CLI запускается как
  `bunx --bun prisma`: под Node переменные из `.env` не подхватятся. Пароли хеширует
  не библиотека, а встроенный `Bun.password` (argon2id).
- **Playwright MCP** — браузер для агента, объявлен в корневом `.mcp.json`
  (`npx @playwright/mcp@latest`). Нужен только при работе через Claude Code и только
  при запущенном `bun run dev`; браузеры ставятся отдельно (`npx playwright install chrome`).
  Серверы из `.mcp.json` Claude Code спрашивает у каждого пользователя при первом
  запуске — детали в корневом `CLAUDE.md`.
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

Регистрация и логин. Оба маршрута принимают `{ email, password }` и возвращают
`{ token }` — JWT (HS256) с `sub` = id пользователя:

```bash
curl -X POST http://localhost:3000/auth/register \
  -H 'content-type: application/json' \
  -d '{"email":"user@example.com","password":"password123"}'
# 201 {"token":"eyJhbGciOiJIUzI1NiIs..."}

curl -X POST http://localhost:3000/auth/login \
  -H 'content-type: application/json' \
  -d '{"email":"user@example.com","password":"password123"}'
# 200 {"token":"..."}
```

Коды ошибок: `409` — e-mail уже занят, `401` — неверные учётные данные (один и тот
же ответ на неизвестный адрес и на неверный пароль), `422` — тело не прошло
валидацию (пароль короче 8 символов, e-mail не похож на адрес).

Кто вошёл — под токеном:

```bash
curl http://localhost:3000/auth/me -H "authorization: Bearer $TOKEN"
# 200 {"id":"01a086d0-...","email":"user@example.com"}
```

Адрес приходит из базы нормализованным (в нижнем регистре), а не в том виде, в
каком его прислали при регистрации. Негодный токен — и токен с годной подписью, но
удалённым пользователем — дают один и тот же `401`: для клиента это одинаково
мёртвая сессия.

Встречи — под авторизацией, токен из логина уходит в заголовок:

```bash
TOKEN=... # token из ответа выше

curl -X POST http://localhost:3000/meetings \
  -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"title":"Планёрка","date":"2026-03-01T13:00:00+03:00","participants":["alice@example.com"]}'
# 201 {"id":"...","title":"Планёрка","date":"2026-03-01T10:00:00.000Z","participants":["alice@example.com"],"createdAt":"..."}

curl http://localhost:3000/meetings -H "authorization: Bearer $TOKEN"
# 200 [...] — только свои встречи, по возрастанию даты

curl http://localhost:3000/meetings/<id> -H "authorization: Bearer $TOKEN"
# 200 {...} либо 404 {"message":"Meeting not found"}
```

Дата принимается в любом корректном ISO-8601, возвращается всегда в UTC. Чужая
встреча отвечает тем же `404`, что и несуществующая, — существование чужих
записей не подтверждается. Без токена (или с негодным) любой маршрут `/meetings`
отдаёт `401`.
