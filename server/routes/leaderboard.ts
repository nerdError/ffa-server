import { Router } from 'express';
import { anonClient } from '../../lib/auth.js';

export const leaderboardRouter = Router();

// GET /api/ratings/leaderboard
leaderboardRouter.get('/', async (_req, res) => {
  const client = anonClient();
  const { data, error } = await client.rpc('get_leaderboard');

  if (error) {
    console.error('[leaderboard] error:', error);
    return res.status(500).json({ error: 'DB error' });
  }

  res.json({ players: data ?? [] });
});