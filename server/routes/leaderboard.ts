import { Router } from 'express';
import { anonClient } from '../../lib/auth.js';

export const leaderboardRouter = Router();

// GET /api/ratings/leaderboard
leaderboardRouter.get('/', async (req, res) => {
  const mode = (req.query.mode as string) || 'all';

  const client = anonClient();

  // Сезонные зачёты по конкретному формату (сентябрь–декабрь 2026), без ELO/активности
  if (mode === 'ffa-league' || mode === 'team-ffa') {
    const { data, error } = await client.rpc('get_season_leaderboard', {
      p_format_slug: mode,
      p_from: '2026-09-01T00:00:00Z',
      p_to: '2027-01-01T00:00:00Z',
    });

    if (error) {
      console.error('[leaderboard] season error:', error);
      return res.status(500).json({ error: 'DB error' });
    }

    return res.json({ players: data ?? [] });
  }

  const validMode = ['all', 'solo', 'team'].includes(mode) ? mode : 'all';
  const { data, error } = await client.rpc('get_leaderboard', { p_mode: validMode });

  if (error) {
    console.error('[leaderboard] error:', error);
    return res.status(500).json({ error: 'DB error' });
  }

  res.json({ players: data ?? [] });
});