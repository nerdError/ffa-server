# SC2 FFA League — гайд для агентов

Сайт лиги StarCraft 2 формата FFA. Прод: sc2-ffa-league.ru (свой сервер), БД Supabase.

## Правила работы (обязательно)

- НЕ рассуждай вслух, не описывай процесс («Let me…», «But wait…»). Сразу код/diff.
- Плохо: «Let me implement the sorting. But wait — the remove handler…», Хорошо: [сразу diff или код]
- Отвечай по-русски и кратко: код, diff или пояснение в 1–2 предложения (лучше комментарием в коде).
- НЕ запускай сборку/проверку (`npm run build`, typecheck) — пользователь сам запускает `npm run dev`.
- SQL для Supabase выдавай текстом — пользователь выполняет сам.
- **Изменение функции в Supabase → сначала `DROP FUNCTION`**, затем `CREATE OR REPLACE` (иначе `cannot change return type of existing function`); для табличных функций под PostgREST/RPC — возможно `DROP ... CASCADE`.
- **Новая таблица Supabase → гранты `service_role`** (по умолчанию не выдаются):
  ```sql
  grant select, insert, update, delete on public.<table> to service_role;
  grant usage, select on sequence public.<table>_id_seq to service_role;
  ```
- **Любая запись/чтение через `service_role` → всегда выдавай права явно.** `service_role` обходит RLS, но ему всё равно нужны табличные привилегии. Если бэкенд (admin-эндпоинт, серверные операции) пишет/читает таблицу — добавь `grant ... on public.<table> to service_role` (для нового столбца на существующей таблице грант на саму таблицу уже покрывает; для новых таблиц — и на sequence). Иначе получишь `permission denied for table <t>` (код 42501). Проверяй при каждом новом доступе к БД, а не только для новых таблиц — например, `profiles` уже была в схеме, а UPDATE через service_role падал.
- Не коммить/пушить, не создавать `.md` без просьбы. Обновляй AGENTS.md компактно.

## Стек и запуск

- Backend: Node.js, TypeScript, Express 5 (`tsx watch`). Frontend: Vite + ванильный DOM (без React/Vue), самописный SPA-роутер.
- БД: Supabase (Postgres + Auth + RLS + RPC). Запись в БД — только через сервер; системные операции — service_role.
- Деплой: GitHub webhook `POST /api/deploy` (HMAC-SHA256) → `deploy.sh`, только ветка `main`.
- Команды: `npm run dev` (server :3000 + vite :5173), `dev:server`, `dev:web`, `build`, `pm2 restart server`.
- ENV: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `GITHUB_WEBHOOK_SECRET`, `PORT`, `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` (CAPTCHA на signup, Cloudflare Turnstile; без них капча выключена).
- Стиль: тёмная SC2-тема, шрифт Zekton, цвета рас T=синий Z=фиолетовый P=жёлтый R=серый, акцент `--gold`. Парсер реплеев: `@replaysremastered/sc2readerjs` (CJS, ~34 МБ).

## Структура

```
server/
  index.ts          Express: статика dist/, SPA-фолбэк, /api/deploy
  overlay-state.ts  in-memory состояние оверлея (SSE) по user_id
  routes/           auth, players, ratings, control, overlay, admin, game-refs, games, leaderboard
lib/
  auth.ts           authenticate(req) (Bearer → Supabase user), anonClient()
  supabase.ts       anon-клиент
  supabase-admin.ts service_role клиент (обходит RLS)
  action-log.ts     logAction() — best-effort запись в action_log
  http.ts           jsonError, methodNotAllowed
web/
  index.html / overlay.html   SPA и страница оверлея для OBS
  src/main.ts       bootstrap + регистрация роутов
  src/app.ts        setupApp, renderUserBox, ensureRolesLoaded
  src/api.ts        apiRequest<T> с авто-refresh при 401
  src/state.ts      токены, user, localStorage
  src/router.ts     SPA-роутер (перехват кликов, mount/unmount)
  src/card.ts       DOM карточки игрока
  src/radar.ts      SVG-радар стиля игры
  src/overlay.ts    SSE-клиент оверлея
  src/pages/        players, games, control, admin, auth, leaderboard
  src/ui/           players, player-detail, auth, ratings
  src/i18n/         ru.ts, en.ts, types.ts (TranslationKey), index.ts
  src/styles/       main.css импортирует остальные; player-card.css и card.css
```

## База данных (Supabase)

- `players` (id, name UNIQUE, aka, user_id→auth.users UNIQUE); `ratings` (player_id, user_id, race T/Z/P/R, 6 статов 1–5, UNIQUE(player_id,user_id)); `profiles` (user_id PK, username UNIQUE; создаёт триггер `handle_new_user`); `user_roles` (user_id, role moderator|admin|ghost); `overlay_tokens` (user_id, token)
- `game_formats` (name, slug, elo_weight, is_team, team_size, color, sort_order); `game_hosts`; `game_mods`; `game_maps` (name UNIQUE, alt_name, deleted_at — мягкое удаление)
- `games` (played_at, format_id, host_id, map_id, mod_id, duration_min, notes, track_elim, created_by); `game_players` (game_id, player_id, race, team, is_winner, eliminated_at; UNIQUE(game_id,player_id))
- `player_ratings` (player_id PK, elo 1500, games_played, wins, activity_score, avg_place, game_days, team/solo_games_played); `rating_history`; `action_log` (actor_id, actor_username, action, entity_type, entity_id, summary, details jsonb)

RPC: `is_admin()`, `is_moderator()`, `has_role()`, `get_email_by_username()`, `get_players_with_stats()`, `get_player_with_stats(id)`, `get_ratings_for_player(id)`, `get_my_rating(id)`, `get_games_list(player_id,limit,offset)`, `get_game_with_players(id)`, `get_player_game_stats(id)`, `get_leaderboard(mode all|solo|team)`, `create_game_with_players(...)`, `update_game_with_players(...)`, `recalculate_all_ratings()`, `handle_new_user()`.

RLS: публичное чтение players/ratings/profiles/games/game_players/справочники/player_ratings/rating_history; запись — своя (auth.uid()) либо moderator/admin; роли и системные операции — только service_role. `action_log` читают только админы, пишет сервер (service_role).

Рейтинг: Elo старт 1500, K=32, max_delta=50, `delta = K*(N-1)*(S-E)*elo_weight`, S по месту. Activity: победа 3.0, дожитие 2.0, выбывание `greatest(0.5, 1+0.3*(N-elim))`, + `LEAST(game_days,30)*0.5`. Считается в `recalculate_all_ratings()`; leaderboard считает active на лету. Известный дисбаланс: одна выигранная игра может обойти ветерана (см. todo.txt).

## Ключевые концепции

- Оценки краудсорсинговые: игрок общий по имени, статы (раса + 6 параметров) ставит каждый залогиненный, средние через `avg()`. Аноним видит только средние.
- Карточка игрока 16:9: иконка расы, ник цветом расы, радар 6 осей, легенда (справа), метрики снизу (activity, games, wins, winrate, avg_place, elo + ранги). Используется на сайте и в оверлее.
- Оверлей OBS: токен из `/control`, ссылка `/overlay?token=...`, SSE `/api/overlay/stream`, состояние in-memory (`overlay-state.ts`), настройки анимации/автоскрытия/viewMode (average|personal|ghost).
- Игры: одиночные (FFA) и командные; у участников раса, команда, победитель и индивидуальное итоговое место (уникальные 1..N у всех, в т.ч. в командах). В команде `is_winner` у всех участников, но на рейтинг влияет только буст: победитель получает S=1.0 и activity 3.0 независимо от места, а `avg_place` берёт индивидуальное место. Место в БД — `game_players.eliminated_at` как порядок выбывания: `place = scale - eliminated_at + 1` (scale = число игроков, всегда); конвертация в `web/src/pages/games.ts` (`entryPlace`/`placeToElim`). После create/update/delete → `recalculate_all_ratings()`.
- Импорт из реплея (модератор): кнопка «Из реплея» → `apiUpload` → `parse-replay` → автозаполнение формы (дата, длительность, карта по имени, игроки: раса/команда/выбывание). Клан-тег снимается (`stripClanTag`), матчинг по `name`/`aka` (`matchCachedPlayer`); ненайденные подсвечиваются и блокируют сохранение.
- Лидерборд: режимы all/solo/team, сортировка по колонкам.
- Роли: moderator (игры, игроки, карты/моды), admin (форматы, ведущие, пользователи, роли), ghost (как moderator + отдельная средняя оценка стиля по ghost-пользователям). Режим карточки/оверлея `ghost` берёт стиль только из оценок GHOST; переключатель над карточкой — средняя/моя/по GHOSTу (`/api/players/:id/stats?mode=`).
- Мультиязычность: RU (дефолт) / EN, `data-i18n`, тип `TranslationKey`, транслитерация ников.

## Эндпоинты (Express)

- `/api/auth` signup|login|logout|me|refresh
- `/api/players` GET list, POST, GET/:id, DELETE/:id, PATCH/:id/name, PATCH/:id/aka, GET/:id/game-stats; вложенные `/api/players/:id/ratings`, `/my-rating`
- `/api/games` GET list?player_id, GET/:id, POST, PATCH/:id, DELETE/:id; `POST /api/games/parse-replay` (модератор; raw `application/octet-stream` ≤25 МБ → `.SC2Replay`)
- `/api/game-refs/:type` (formats|hosts|maps|mods) CRUD
- `/api/ratings/leaderboard?mode=`
- `/api/control` state|show|hide|settings|token|token/regenerate
- `/api/overlay` state|stream|player/:id (SSE)
- `/api/admin` users, roles/grant|revoke, ratings/:id DELETE, players/:id/ratings, players/:id/name|aka, users/:id DELETE, players/:id/link-user|unlink-user, logs (GET, admin-only, q/action/limit/offset)
- `/api/health`, `/api/deploy`

## Лог действий

Таблица `action_log` (гранты service_role), запись через `lib/action-log.ts` → `logAction()` (best-effort, не ломает запрос). Логируются signup/login/logout, player create/rename/aka/delete/link/unlink, rating create/update/delete, game create/update/delete, ref create/update/delete, role grant/revoke, user delete. UI — секция «Лог действий» в админке (фильтр по типу, поиск, обновить).

## Грабки / правила, выученные на практике

- `web/src/overlay.ts` должен импортировать `player-card.css` **и** `card.css` (иначе пропадают правая колонка статов и метрики внизу).
- `/api/overlay/player/:id` обязан возвращать полный `PlayerWithStats` (RPC `get_player_with_stats`), иначе `card.ts` падает на `toFixed`. `card.ts` читает метрики безопасно (Number.isFinite).
- Реплей SC2 начинается с `MPQ\x1B` (user-data header), а `MPQ\x1A` — заголовок архива внутри файла; проверять `\x1B`, иначе валидный реплей отбивается как «not MPQ».
- HTTP-заголовок `X-File-Name` только ISO-8859-1 → клиент шлёт `encodeURIComponent(file.name)`, сервер `decodeURIComponent`.
- `sc2readerjs` отдаёт `race` локализованной → маппить латиницу и кириллицу (`normalizeReplayRace`). Для нового build нет протокола → warning и fallback; summary/eco обычно ок, `loadChat`/часть game events может падать.
- Карты: `alt_name` — альт. название (локализация клиента), `deleted_at` — мягкое удаление. Из реплея матчатся по `name` ИЛИ `alt_name` среди неудалённых и НЕ создаются автоматически: если не найдена, форма предлагает добавить вариант названия выбранной карте либо новую карту. Удаление в админке мягкое (игры сохраняют ссылку); в карточке игры такая карта красная «карта удалена», в фильтре есть пункт «карта удалена». Альт. название правится в форме игры (при выбранной карте) и в админке; восстановление — кнопкой ↩.
- Удалять игры может только админ (`DELETE /api/games/:id` проверяет `is_admin`), кнопка удаления видна только админу. `updated_at` показывается у ника добавившего только moderator/admin и только если игру правили (`updated_at != created_at`).
- Сохранение/удаление игры обновляет только затронутую день-группу (`applyEditedGame`/`removeGameFromList`, `web/src/pages/games.ts`), без полного перерендера.
- Дни в списке игр сворачиваются кликом по шапке (`buildDayGroup`); по умолчанию развёрнут только последний (свежий). Скрытие — через CSS `max-height` (не `display:none`), чтобы работал Ctrl+F по скрытым играм.
- Командные настройки формы: размер команды (`field-team-size`) и число команд (`field-team-count`). Слоты (teamCount × teamSize) создаются сразу и не удаляются — крестик очищает слот (`clearDraftPlayer`), заполняются автокомплитом. Валидация требует заполнить все слоты.
- Бан аккаунта: `profiles.banned_at` (nullable). Проверяется в `lib/auth.ts` `authenticate()` (все авторизованные запросы) и в login/refresh (`server/routes/auth.ts`). Админ-эндпоинты `POST /api/admin/users/:id/ban|unban`; бан ставит `can_rate=false`, анбан — `can_rate=true`. Rate-limit signup по IP — `lib/rate-limit.ts` (in-memory, 3/10 мин); `app.set('trust proxy', 1)` в `server/index.ts`. CAPTCHA — Cloudflare Turnstile, `GET /api/auth/captcha-config`, проверка в signup через siteverify.
- `can_rate=false` = «shadow ban»: пользователь может ставить/видеть свои оценки, но они не идут в средние (RPC `get_players_with_stats`/`get_player_with_stats` фильтруют `can_rate=false`; ghost-режим — `player-stats.ts filterEnabledUserIds`). Если на игроке нет учитываемых оценок, исключённому юзеру в режиме «средняя» его собственная оценка показывается через `applyShadowFallback` в `player-detail.ts` (чтобы не выдавать shadow-ban). В списке оценок исключённые помечаются бейджем `excluded` (флаг в `get_ratings_for_player`).
- Архив удалённых оценок: таблица `ratings_archive` (нужны гранты `service_role` + на sequence). Все удаления оценок (админ: одиночное и «удалить все»; юзер: своя оценка) сначала копируют строки в архив через `lib/ratings-archive.ts archiveRatings()`. Восстановление — `POST /api/admin/ratings/:id/restore` и `POST /api/admin/ratings/archive/restore-user/:userId` (upsert в `ratings` по `player_id,user_id`), список — `GET /api/admin/ratings/archive`. UI — секция «Архив удалённых оценок» в админке.
