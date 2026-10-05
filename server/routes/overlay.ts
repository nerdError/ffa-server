import { Router } from 'express';
import { getState, addSubscriber, debugStats } from '../overlay-state.js';
import { getPlayerWithStatsMode, type StatsMode } from '../player-stats.js';
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
//  - average:  средние (то же, что /api/players/:id)
//  - personal: оценки владельца токена
//  - ghost:    средняя только по пользователям с ролью GHOST
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

  try {
    const player = await getPlayerWithStatsMode(
      playerId,
      viewMode as StatsMode,
      viewMode === 'personal' ? userId : null
    );
    if (!player) return res.status(404).json({ error: 'Player not found' });
    return res.json({ player });
  } catch (err) {
    console.error('[overlay/player] stats error:', err);
    return res.status(500).json({ error: 'DB error' });
  }
});