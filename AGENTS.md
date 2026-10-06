# SC2 FFA League — рабочий гайд для агентов

Сайт лиги StarCraft 2 формата FFA. Прод: sc2-ffa-league.ru (свой сервер), БД Supabase.

## Правила работы (обязательно)

- НЕ рассуждай вслух. Не описывай свои действия. Не пиши «Let me…», «Now I'll…», «But wait…», «Let me check…». Никак не описывай процесс своей работы.
- Отвечай только кодом, diff'ом или кратким пояснением (1–2 предложения).
- Если нужно объяснить — делай это в комментарии к коду, а не в тексте ответа.
- Отвечай по-русски и кратко.
- НЕ запускай команды сборки/проверки (`npm run build`, `typecheck` и т.п.). Пользователь сам запускает `npm run dev`.
- SQL для Supabase выдавай текстом — пользователь выполняет его сам.
- **Изменение существующей функции в Supabase → всегда сначала `DROP FUNCTION`** (и только потом `CREATE OR REPLACE`): Supabase не даёт менять сигнатуру/тип возврата существующей функции (`cannot change return type of existing function`). Для табличных функций, используемых PostgREST/RPC, может понадобиться `DROP FUNCTION ... CASCADE`.
- **Новая таблица в Supabase → всегда выдавай гранты `service_role`** (Supabase не делает это по умолчанию):
  ```sql
  grant select, insert, update, delete on public.<table> to service_role;
  grant usage, select on sequence public.<table>_id_seq to service_role;
  ```
  Иначе серверная роль получит `permission denied for table`.
- Не коммить и не пушить без явной просьбы.
- Не создавай `.md`-файлы без просьбы.
- Обновляй AGENTS.md при необходимости, сохраняя его компактность

## Стек и запуск

- Backend: Node.js, TypeScript, Express 5, запуск через `tsx watch`.
- Frontend: Vite, TypeScript, ванильный DOM (без React/Vue), самописный SPA-роутер.
- БД: Supabase (Postgres + Auth + RLS + RPC). Обращение к БД — только через сервер (Express) и service_role для системных операций.
- Деплой: GitHub webhook `POST /api/deploy` (HMAC-SHA256) → `deploy.sh` на сервере, работает только ветка `main`.
- Команды: `npm run dev` (server :3000 + vite :5173), `npm run dev:server`, `npm run dev:web`, `npm run build`, `pm2 restart server`.
- ENV (.env): `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `GITHUB_WEBHOOK_SECRET`, `PORT`.
- Стиль: тёмная SC2-тема, шрифт Zekton, цвета рас T=синий Z=фиолетовый P=жёлтый R=серый, золотой акцент `--gold`.
- Парсер реплеев: `@replaysremastered/sc2readerjs` (CJS, ~34 МБ, ставится через `npm install`).

## Структура

```
server/
  index.ts                точка входа Express, статика dist/, SPA-фолбэк, /api/deploy
  overlay-state.ts        in-memory состояние оверлея (SSE) по user_id
  routes/                 auth, players, ratings, control, overlay, admin, game-refs, games, leaderboard
lib/
  auth.ts                 authenticate(req) (Bearer → Supabase user), anonClient()
  supabase.ts             anon-клиент
  supabase-admin.ts       service_role клиент (обходит RLS)
  action-log.ts           logAction() — пишет в action_log, никогда не бросает
  http.ts                 jsonError, methodNotAllowed
web/
  index.html              основная SPA-страница
  overlay.html            страница оверлея для OBS
  src/main.ts             bootstrap + регистрация роутов
  src/app.ts              setupApp, renderUserBox, ensureRolesLoaded
  src/api.ts              apiRequest<T> с авто-refresh при 401
  src/state.ts            токены, user, localStorage
  src/router.ts           SPA-роутер (перехват кликов, mount/unmount)
  src/card.ts             DOM карточки игрока
  src/radar.ts            SVG-радар стиля игры
  src/overlay.ts          SSE-клиент оверлея
  src/pages/              players, games, control, admin, auth, leaderboard
  src/ui/                 players, player-detail, auth, ratings
  src/i18n/               ru.ts, en.ts, types.ts (TranslationKey), index.ts
  src/styles/             main.css импортирует остальные; player-card.css и card.css
```

## База данных (Supabase)

Таблицы: `players` (id, name UNIQUE, aka, user_id→auth.users UNIQUE), `ratings` (player_id, user_id, race T/Z/P/R, 6 статов 1–5, UNIQUE(player_id,user_id)), `profiles` (user_id PK, username UNIQUE; создаётся триггером `handle_new_user`), `user_roles` (user_id, role moderator|admin|ghost), `overlay_tokens` (user_id, token), `game_formats` (name, slug, elo_weight, is_team, team_size, color, sort_order), `game_hosts`, `game_maps`, `game_mods`, `games` (played_at, format_id, host_id, map_id, mod_id, duration_min, notes, track_elim, created_by), `game_players` (game_id, player_id, race, team, is_winner, eliminated_at; UNIQUE(game_id,player_id)), `player_ratings` (player_id PK, elo 1500, games_played, wins, activity_score, avg_place, game_days, team/solo_games_played), `rating_history`, `action_log` (лог действий: actor_id, actor_username, action, entity_type, entity_id, summary, details jsonb).

RPC: `is_admin()`, `is_moderator()`, `has_role()`, `get_email_by_username()`, `get_players_with_stats()`, `get_player_with_stats(id)`, `get_ratings_for_player(id)`, `get_my_rating(id)`, `get_games_list(player_id,limit,offset)`, `get_game_with_players(id)`, `get_player_game_stats(id)`, `get_leaderboard(mode all|solo|team)`, `create_game_with_players(...)`, `update_game_with_players(...)`, `recalculate_all_ratings()`, `handle_new_user()`.

RLS: публичное чтение players/ratings/profiles/games/game_players/справочники/player_ratings/rating_history; запись — свои (auth.uid()) или модератор/админ; роли и системные операции — только через service_role. `action_log` — чтение только админам, запись с сервера (service_role).

Рейтинг: Elo старт 1500, K=32, max_delta=50, `delta = K*(N-1)*(S-E)*elo_weight`, S по месту. Activity: победа 3.0, дожитие 2.0, выбывание `greatest(0.5, 1+0.3*(N-elim))`, + `LEAST(game_days,30)*0.5`. Всё считается в `recalculate_all_ratings()`; leaderboard считает active на лету. Известная проблема баланса: одна выигранная игра может обойти ветерана (см. todo.txt).

## Ключевые концепции

- Оценки краудсорсинговые: игрок общий по имени, статы (раса+6 параметров) ставит каждый залогиненный, средние через `avg()`. Аноним видит только средние.
- Карточка игрока 16:9: иконка расы, ник цветом расы, радар 6 осей, легенда (справа), метрики снизу (activity, games, wins, winrate, avg_place, elo + ранги). Используется на сайте и в оверлее.
- Оверлей OBS: токен из `/control`, ссылка `/overlay?token=...`, SSE `/api/overlay/stream`, состояние in-memory (`overlay-state.ts`), настройки анимации/автоскрытия/viewMode (average|personal|ghost).
- Игры: одиночные (FFA) и командные; участники с расой, командой, победителем и итоговым местом (победитель — 1, остальные — уникальные 2..N; в командах место общее для команды). В форме ищутся/заполняются именно места. В БД место по-прежнему хранится в `game_players.eliminated_at` как порядок выбывания: `place = scale - eliminated_at + 1`, где scale = число игроков (solo) или команд (team); конвертация в `web/src/pages/games.ts` (`entryPlace`/`placeToElim`). После create/update/delete → `recalculate_all_ratings()`.
- Импорт игры из реплея (модератор): кнопка «Из реплея» → `apiUpload` → `parse-replay` → форма автозаполняется (дата, длительность, карта по имени, игроки: раса/команда/выбывание). Клан-тег снимается (`stripClanTag`), матчинг игроков по `name`/`aka` (`matchCachedPlayer`); ненайденные подсвечиваются и блокируют сохранение.
- Лидерборд: режимы all/solo/team, сортировка по колонкам.
- Роли: moderator (игры, игроки, карты/моды), admin (форматы, ведущие, пользователи, роли), ghost (как moderator; отдельная средняя оценка стиля по пользователям с этой ролью). Режим карточки/оверлея `ghost` берёт стиль только из оценок GHOST; переключатель над карточкой — средняя/моя/по GHOSTу (`/api/players/:id/stats?mode=`).
- Мультиязычность: RU (дефолт) / EN, `data-i18n`, тип `TranslationKey`, транслитерация ников.

## Эндпоинты (Express)

- `/api/auth` signup|login|logout|me|refresh
- `/api/players` (GET list, POST, GET/:id, DELETE/:id, PATCH/:id/name, PATCH/:id/aka, GET/:id/game-stats) + вложенные `/api/players/:id/ratings`, `/my-rating`
- `/api/games` (GET list?player_id, GET/:id, POST, PATCH/:id, DELETE/:id) + `POST /api/games/parse-replay` (модератор; raw `application/octet-stream` ≤25 МБ → разбор `.SC2Replay`)
- `/api/game-refs/:type` (formats|hosts|maps|mods) CRUD
- `/api/ratings/leaderboard?mode=`
- `/api/control` state|show|hide|settings|token|token/regenerate
- `/api/overlay` state|stream|player/:id (SSE)
- `/api/admin` users, roles/grant|revoke, ratings/:id DELETE, players/:id/ratings, players/:id/name|aka, users/:id DELETE, players/:id/link-user|unlink-user, **logs** (GET, admin-only, q/action/limit/offset)
- `/api/health`, `/api/deploy`

## Лог действий

- Таблица `action_log` (+ гранты service_role). Пишется через `lib/action-log.ts` → `logAction()` (best-effort, не ломает запрос).
- Логируются: signup/login/logout, player create/rename/aka/delete/link/unlink, rating create/update/delete, game create/update/delete, ref create/update/delete, role grant/revoke, user delete.
- UI: секция «Лог действий» в админке (фильтр по типу, поиск, обновить).

## Грабки / правила, выученные на практике

- `web/src/overlay.ts` должен импортировать `player-card.css` **и** `card.css` (иначе пропадает правая колонка статов и метрики внизу).
- Серверный роут `/api/overlay/player/:id` обязан возвращать полный `PlayerWithStats` (из RPC `get_player_with_stats`), а не урезанный объект — иначе `card.ts` падает на `toFixed`.
- `card.ts` читает метрики безопасно (Number.isFinite), но формат объекта должен совпадать с `PlayerWithStats`.
- Новые таблицы Supabase: не забывать про гранты `service_role` (см. выше).
- Техдолг в `server/index.ts`: дублируются `app.use(...)` для части роутов; есть отладочный `console.log("hello there %%%%")`.
- В `web/index.html` id кнопок `btn-add-format` / `btn-add-host`, а `admin.ts` ждёт `btn-add-formats` / `btn-add-hosts` — кнопки «+ Добавить» не срабатывают (известный баг).
- `package.json`: `"type": "commonjs"` при ES-модулях. Legacy: таблица `moderators`, папки `api/`, `vercel.json`.
- Реплей SC2 начинается с `MPQ\x1B` (user-data header), а `MPQ\x1A` — заголовок архива внутри файла; проверять `\x1B`, иначе валидный реплей отбивается как «not MPQ».
- HTTP-заголовок `X-File-Name` только ISO-8859-1 → клиент шлёт `encodeURIComponent(file.name)`, сервер `decodeURIComponent`.
- `sc2readerjs` отдаёт `race` локализованной («Протоссы/Терраны/Зерги») → маппить и латиницу, и кириллицу (`normalizeReplayRace`).
- Для нового build у `sc2readerjs` нет протокола → warning и fallback; summary/eco обычно ок, но `loadChat`/часть game events может падать.
- Победитель авто: `m_result = Win` либо единственный доживший при выбывших (last man standing). Кастомные FFA часто не пишут результат → победитель вручную.
- Выбывание — эвристика по прекращению tracker-статистики (`loadEcoTimeline`, порог 30 с); только solo-режим, не гарантия.