import { Router } from 'express';
import { anonClient, authenticate } from '../../lib/auth.js';

export const ratingsRouter = Router({ mergeParams: true });

const RACES = ['T', 'Z', 'P', 'R'] as const;
const STATS = [
  'adaptiveness',
  'greed',
  'survival',
  'turtle',
  'aggression',
  'variety',
] as const;

function validateRating(body: any): string | null {
  if (!RACES.includes(body?.race)) {
    return `race must be one of ${RACES.join(', ')}`;
  }
  for (const stat of STATS) {
    const v = body[stat];
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > 5) {
      return `${stat} must be an integer between 1 and 5`;
    }
  }
  return null;
}

function parseId(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// GET /api/players/:id/ratings
ratingsRouter.get('/:id/ratings', async (req, res) => {
  const playerId = parseId(req.params.id);
  if (playerId === null) return res.status(400).json({ error: 'Invalid player id' });

  // Проверим, что игрок существует
  const anon = anonClient();
  const { data: player, error: playerErr } = await anon
    .from('players')
    .select('id')
    .eq('id', playerId)
    .maybeSingle();
  if (playerErr) return res.status(500).json({ error: playerErr.message });
  if (!player) return res.status(404).json({ error: 'Player not found' });

  // Если есть токен — используем его клиент, иначе анонимный
  let client = anon;
  if (req.headers.authorization?.startsWith('Bearer ')) {
    const auth = await authenticate(req);
    if (auth.ok) client = auth.client;
  }

  const { data, error } = await client.rpc('get_ratings_for_player', {
    p_id: playerId,
  });
  if (error) return res.status(500).json({ error: error.message });

  return res.status(200).json({ ratings: data ?? [] });
});

// POST /api/players/:id/ratings — upsert своей оценки
ratingsRouter.post('/:id/ratings', async (req, res) => {
  const playerId = parseId(req.params.id);
  if (playerId === null) return res.status(400).json({ error: 'Invalid player id' });

  const auth = await authenticate(req);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  const { data: player, error: playerErr } = await auth.client
    .from('players')
    .select('id')
    .eq('id', playerId)
    .maybeSingle();
  if (playerErr) return res.status(500).json({ error: playerErr.message });
  if (!player) return res.status(404).json({ error: 'Player not found' });

  const validationError = validateRating(req.body);
  if (validationError) return res.status(400).json({ error: validationError });

  const { race, ...stats } = req.body;

  const { data, error } = await auth.client
    .from('ratings')
    .upsert(
      { player_id: playerId, user_id: auth.user.id, race, ...stats },
      { onConflict: 'player_id,user_id' }
    )
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ rating: data });
});

// GET /api/players/:id/my-rating
ratingsRouter.get('/:id/my-rating', async (req, res) => {
  const playerId = parseId(req.params.id);
  if (playerId === null) return res.status(400).json({ error: 'Invalid player id' });

  const auth = await authenticate(req);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  const { data, error } = await auth.client.rpc('get_my_rating', {
    p_id: playerId,
  });
  if (error) return res.status(500).json({ error: error.message });

  const rating = data && data.length > 0 ? data[0] : null;
  return res.status(200).json({ rating });
});

// DELETE /api/players/:id/my-rating
ratingsRouter.delete('/:id/my-rating', async (req, res) => {
  const playerId = parseId(req.params.id);
  if (playerId === null) return res.status(400).json({ error: 'Invalid player id' });

  const auth = await authenticate(req);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  const { data, error } = await auth.client
    .from('ratings')
    .delete()
    .eq('player_id', playerId)
    .eq('user_id', auth.user.id)
    .select()
    .maybeSingle();

  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Rating not found' });
  return res.status(200).json({ deleted: data });
});