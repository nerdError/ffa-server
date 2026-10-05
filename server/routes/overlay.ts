import { Router } from 'express';
import { getState, addSubscriber, debugStats } from '../overlay-state.js';
import { supabaseAdmin } from '../../lib/supabase-admin';

export const overlayRouter = Router();

/**
 * Проверяет токен оверлея и возвращает user_id.
 * Возвращает null, если токен невалиден.
 */
async function resolveUserId(token: string): Promise<string | null> {
  if (!token || typeof token !== 'string') return null;

  const { data, error } = await supabaseAdmin
    .from('overlay_tokens')
    .select('user_id')
    .eq('token', token)
    .maybeSingle();

  if (error) {
    console.error('[overlay] token lookup failed:', error);
    return null;
  }

  return data?.user_id ?? null;
}

// ============================================================
// GET /api/overlay/state?token=...
// ============================================================
overlayRouter.get('/state', async (req, res) => {
  const token = String(req.query.token ?? '');
  if (!token) return res.status(401).json({ error: 'Missing token' });

  const userId = await resolveUserId(token);
  if (!userId) return res.status(401).json({ error: 'Invalid token' });

  res.json(getState(userId));
});

// ============================================================
// GET /api/overlay/stream?token=...
// ============================================================
overlayRouter.get('/stream', async (req, res) => {
  const token = String(req.query.token ?? '');
  if (!token) return res.status(401).json({ error: 'Missing token' });

  const userId = await resolveUserId(token);
  if (!userId) return res.status(401).json({ error: 'Invalid token' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  req.socket.setTimeout(0);
  req.socket.setNoDelay(true);
  req.socket.setKeepAlive(true);

  // Начальное состояние сразу
  res.write(`data: ${JSON.stringify(getState(userId))}\n\n`);

  addSubscriber(userId, res);

  const heartbeat = setInterval(() => {
    try {
      res.write(': heartbeat\n\n');
    } catch {
      clearInterval(heartbeat);
    }
  }, 25_000);

  res.on('close', () => clearInterval(heartbeat));
});

// Диагностика (временно)
overlayRouter.get('/debug', (_req, res) => {
  res.json(debugStats());
});

// ============================================================
// GET /api/overlay/player/:id?token=...
// Возвращает игрока в зависимости от viewMode:
//  - average: средние (то же, что /api/players/:id)
//  - personal: оценки владельца токена
// ============================================================
overlayRouter.get('/player/:id', async (req, res) => {
  const token = String(req.query.token ?? '');
  if (!token) return res.status(401).json({ error: 'Missing token' });

  const userId = await resolveUserId(token);
  if (!userId) return res.status(401).json({ error: 'Invalid token' });

  const playerId = Number(req.params.id);
  if (!Number.isInteger(playerId) || playerId <= 0) {
    return res.status(400).json({ error: 'Invalid player id' });
  }

  // Получаем настройки пользователя, чтобы знать viewMode
  const state = getState(userId);
  const viewMode = state.settings.viewMode ?? 'average';

  // Загружаем базовые данные игрока (имя, aka)
  const { data: player, error: playerErr } = await supabaseAdmin
    .from('players')
    .select('id, name, aka')
    .eq('id', playerId)
    .maybeSingle();

  if (playerErr) {
    console.error('[overlay/player] player error:', playerErr);
    return res.status(500).json({ error: 'DB error' });
  }
  if (!player) return res.status(404).json({ error: 'Player not found' });

  // Получаем расы и средние для игрока
  const { data: stats, error: statsErr } = await supabaseAdmin.rpc(
    'get_player_with_stats',
    { p_id: playerId }
  );

  if (statsErr) {
    console.error('[overlay/player] stats error:', statsErr);
    return res.status(500).json({ error: 'DB error' });
  }

  // Полная карточка: стиль игры + метрики (elo, games, wins, winrate,
  // activity, avg_place, game_days, ранги). В personal-режиме переопределяем
  // только оценки стиля и расы, а метрики берём из общей статистики.
  const base = stats?.[0] ?? {
    id: player.id,
    name: player.name,
    aka: player.aka,
    user_id: null,
    races: [],
    dominant_race: null,
    vote_count: 0,
    adaptiveness: null,
    greed: null,
    survival: null,
    turtle: null,
    aggression: null,
    variety: null,
    elo: 1500,
    games_played: 0,
    wins: 0,
    winrate: 0,
    activity_score: 0,
    avg_place: null,
    game_days: 0,
    activity_rank: null,
    elo_rank: null,
  };

  // Если режим average — отдаём полную карточку как есть
  if (viewMode === 'average') {
    return res.json({ player: base });
  }

  // Режим personal — берём оценку владельца токена
  const { data: myRating, error: myErr } = await supabaseAdmin
    .from('ratings')
    .select('race, adaptiveness, greed, survival, turtle, aggression, variety')
    .eq('player_id', playerId)
    .eq('user_id', userId)
    .maybeSingle();

  if (myErr) {
    console.error('[overlay/player] rating error:', myErr);
    return res.status(500).json({ error: 'DB error' });
  }

  // Нет своей оценки — стиль пустой, но метрики сохраняем
  const styleOverride = myRating
    ? {
        races: [myRating.race],
        vote_count: 1,
        adaptiveness: myRating.adaptiveness,
        greed: myRating.greed,
        survival: myRating.survival,
        turtle: myRating.turtle,
        aggression: myRating.aggression,
        variety: myRating.variety,
      }
    : {
        races: [],
        vote_count: 0,
        adaptiveness: null,
        greed: null,
        survival: null,
        turtle: null,
        aggression: null,
        variety: null,
      };

  return res.json({ player: { ...base, ...styleOverride } });
});