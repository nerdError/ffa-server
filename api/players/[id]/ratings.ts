import type { VercelRequest, VercelResponse } from '@vercel/node';
import { anonClient, authenticate } from '../../../lib/auth';
import { jsonError, methodNotAllowed } from '../../../lib/http';

const RACES = ['T', 'Z', 'P', 'R'] as const;
const STATS = [
  'adaptiveness',
  'greed',
  'survival',
  'turtle',
  'aggression',
  'variety',
] as const;

function parseId(raw: string | string[] | undefined): number | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return null;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const playerId = parseId(req.query.id);
  if (playerId === null) return jsonError(res, 400, 'Invalid player id');

  // GET /api/players/:id/ratings — публичный, но аноним увидит пустой список
  if (req.method === 'GET') {
    // Проверим, что игрок существует
    const anon = anonClient();
    const { data: player, error: playerErr } = await anon
      .from('players')
      .select('id')
      .eq('id', playerId)
      .maybeSingle();
    if (playerErr) return jsonError(res, 500, playerErr.message);
    if (!player) return jsonError(res, 404, 'Player not found');

    // Попробуем извлечь токен, если он есть. Если нет — просто анонимный вызов.
    let client = anon;
    const header = req.headers.authorization ?? req.headers.Authorization;
    if (header && typeof header === 'string' && header.startsWith('Bearer ')) {
      const auth = await authenticate(req);
      if (auth.ok) client = auth.client;
    }

    const { data, error } = await client.rpc('get_ratings_for_player', {
      p_id: playerId,
    });
    if (error) return jsonError(res, 500, error.message);

    // Аноним получит [] (функция вернёт пусто из-за auth.uid() is not null)
    return res.status(200).json({ ratings: data ?? [] });
  }

  // POST /api/players/:id/ratings — upsert своей оценки
  if (req.method === 'POST') {
    const auth = await authenticate(req);
    if (!auth.ok) return jsonError(res, auth.status, auth.error);

    // Проверим, что игрок существует
    const { data: player, error: playerErr } = await auth.client
      .from('players')
      .select('id')
      .eq('id', playerId)
      .maybeSingle();
    if (playerErr) return jsonError(res, 500, playerErr.message);
    if (!player) return jsonError(res, 404, 'Player not found');

    const validationError = validateRating(req.body);
    if (validationError) return jsonError(res, 400, validationError);

    const { race, ...stats } = req.body;

    const { data, error } = await auth.client
      .from('ratings')
      .upsert(
        {
          player_id: playerId,
          user_id: auth.user.id,
          race,
          ...stats,
        },
        { onConflict: 'player_id,user_id' }
      )
      .select()
      .single();

    if (error) return jsonError(res, 500, error.message);
    return res.status(200).json({ rating: data });
  }

  return methodNotAllowed(res, ['GET', 'POST']);
}