import { Router } from 'express';
import { anonClient } from '../../lib/auth.js';
import { cached } from '../../lib/cache.js';

export const leaderboardRouter = Router();

// TTL лидерборда: короткий — пересчёт Elo и так редкий, а нагрузку снимает.
const LEADERBOARD_TTL_MS = 15_000;

// GET /api/ratings/leaderboard
leaderboardRouter.get('/', async (req, res) => {
  const mode = (req.query.mode as string) || 'all';
  const days = req.query.days ? Number(req.query.days) : null;

  // Сезонные зачёты по конкретному формату (сентябрь–декабрь 2026), без ELO/активности
  if (mode === 'ffa-league' || mode === 'team-ffa') {
    try {
      const players = await cached(`pub:leaderboard:${mode}`, LEADERBOARD_TTL_MS, async () => {
        const client = anonClient();
        const { data, error } = await client.rpc('get_season_leaderboard', {
          p_format_slug: mode,
          p_from: '2026-09-01T00:00:00Z',
          p_to: '2027-01-01T00:00:00Z',
        });
        if (error) throw error;
        return data ?? [];
      });

      return res.json({ players });
    } catch (err) {
      console.error('[leaderboard] season error:', err);
      return res.status(500).json({ error: 'DB error' });
    }
  }

  const validMode = ['all', 'solo', 'team'].includes(mode) ? mode : 'all';
  const daysParam = Number.isFinite(days) && days !== null ? days : null;

  try {
    const players = await cached(
      `pub:leaderboard:${validMode}:${daysParam ?? 'all'}`,
      LEADERBOARD_TTL_MS,
      async () => {
        const client = anonClient();
        const { data, error } = await client.rpc('get_leaderboard', {
          p_mode: validMode,
          p_days: daysParam,
        });
        if (error) throw error;
        return data ?? [];
      }
    );

    return res.json({ players });
  } catch (err) {
    console.error('[leaderboard] error:', err);
    return res.status(500).json({ error: 'DB error' });
  }
});