import { Router } from 'express';
import { anonClient } from '../../lib/auth.js';

export const leaderboardRouter = Router();

// GET /api/ratings/leaderboard
leaderboardRouter.get('/', async (req, res) => {
  const mode = (req.query.mode as string) || 'all';
  const validMode = ['all', 'solo', 'team'].includes(mode) ? mode : 'all';

  const client = anonClient();
  const { data, error } = await client.rpc('get_leaderboard', { p_mode: validMode });

  if (error) {
    console.error('[leaderboard] error:', error);
    return res.status(500).json({ error: 'DB error' });
  }

  res.json({ players: data ?? [] });
});