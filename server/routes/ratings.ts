import { Router } from 'express';
import { anonClient, authenticate } from '../../lib/auth.js';
import { supabaseAdmin } from '../../lib/supabase-admin.js';
import { logAction } from '../../lib/action-log.js';
import { archiveRatings } from '../../lib/ratings-archive.js';
import { cached } from '../../lib/cache.js';

export const ratingsRouter = Router({ mergeParams: true });

// TTL публичных данных оценок (список оценок игрока).
const RATINGS_TTL_MS = 15_000;

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

  try {
    const ratings = await cached(`pub:ratings:${playerId}`, RATINGS_TTL_MS, async () => {
      const { data, error } = await client.rpc('get_ratings_for_player', {
        p_id: playerId,
      });
      if (error) throw error;

      const rows = (data ?? []) as Record<string, any>[];

      // Проставляем признак роли GHOST для бейджей в списке оценок.
      const userIds = [...new Set(rows.map((r) => r.user_id).filter(Boolean))];
      if (userIds.length > 0) {
        const { data: ghostRows, error: ghostErr } = await supabaseAdmin
          .from('user_roles')
          .select('user_id')
          .eq('role', 'ghost')
          .in('user_id', userIds);
        if (!ghostErr) {
          const ghostSet = new Set((ghostRows ?? []).map((r) => r.user_id));
          for (const r of rows) r.is_ghost = ghostSet.has(r.user_id);
        }
      }

      return rows;
    });

    return res.status(200).json({ ratings });
  } catch (err: any) {
    return res.status(500).json({ error: err?.message ?? 'DB error' });
  }
});

// GET /api/players/:id/given-ratings
// Оценки, которые сам игрок (если связан с профилем) поставил другим игрокам.
ratingsRouter.get('/:id/given-ratings', async (req, res) => {
  const playerId = parseId(req.params.id);
  if (playerId === null) return res.status(400).json({ error: 'Invalid player id' });

  const { data: player, error: playerErr } = await supabaseAdmin
    .from('players')
    .select('id, user_id')
    .eq('id', playerId)
    .maybeSingle();
  if (playerErr) return res.status(500).json({ error: playerErr.message });
  if (!player) return res.status(404).json({ error: 'Player not found' });

  // Игрок не связан с профилем — оценок от его имени быть не может.
  if (!player.user_id) return res.status(200).json({ ratings: [] });

  const { data, error } = await supabaseAdmin
    .from('ratings')
    .select(
      'id, player_id, race, adaptiveness, greed, survival, turtle, aggression, variety, ' +
        'created_at, updated_at',
    )
    .eq('user_id', player.user_id)
    .order('created_at', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });

  // Подтягиваем имена игроков, которых оценил пользователь.
  const targetIds = [...new Set((data ?? []).map((r) => r.player_id))];
  const nameById = new Map<number, string>();
  if (targetIds.length > 0) {
    const { data: targets } = await supabaseAdmin
      .from('players')
      .select('id, name')
      .in('id', targetIds);
    for (const t of targets ?? []) nameById.set(t.id, t.name);
  }

  const ratings = (data ?? []).map((r: any) => ({
    id: r.id,
    player_id: r.player_id,
    player_name: nameById.get(r.player_id) ?? null,
    race: r.race,
    adaptiveness: r.adaptiveness,
    greed: r.greed,
    survival: r.survival,
    turtle: r.turtle,
    aggression: r.aggression,
    variety: r.variety,
    created_at: r.created_at,
    updated_at: r.updated_at,
  }));

  return res.status(200).json({ ratings });
});

// POST /api/players/:id/ratings — upsert своей оценки
ratingsRouter.post('/:id/ratings', async (req, res) => {
  const playerId = parseId(req.params.id);
  if (playerId === null) return res.status(400).json({ error: 'Invalid player id' });

  const auth = await authenticate(req);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  const { data: player, error: playerErr } = await auth.client
    .from('players')
    .select('id, name')
    .eq('id', playerId)
    .maybeSingle();
  if (playerErr) return res.status(500).json({ error: playerErr.message });
  if (!player) return res.status(404).json({ error: 'Player not found' });

  const validationError = validateRating(req.body);
  if (validationError) return res.status(400).json({ error: validationError });

  const { race, ...stats } = req.body;

  // Проверяем, была ли уже оценка — чтобы понять create/update
  const { data: existing } = await auth.client
    .from('ratings')
    .select('id')
    .eq('player_id', playerId)
    .eq('user_id', auth.user.id)
    .maybeSingle();

  const { data, error } = await auth.client
    .from('ratings')
    .upsert(
      { player_id: playerId, user_id: auth.user.id, race, ...stats },
      { onConflict: 'player_id,user_id' }
    )
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });

  void logAction({
    action: existing ? 'rating.update' : 'rating.create',
    actorId: auth.user.id,
    entityType: 'rating',
    entityId: data.id,
    summary: `${existing ? 'Изменена' : 'Добавлена'} оценка игрока "${player.name}" (${race})`,
    details: { playerId, race },
  });

  return res.status(200).json({ rating: data });
});

// GET /api/players/:id/my-rating
ratingsRouter.get('/:id/my-rating', async (req, res) => {
    try {
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
    }
    catch (e) {
        console.error(e);
        return res.status(404).json({ rating: null });
    }
});

// DELETE /api/players/:id/my-rating
ratingsRouter.delete('/:id/my-rating', async (req, res) => {
  const playerId = parseId(req.params.id);
  if (playerId === null) return res.status(400).json({ error: 'Invalid player id' });

  const auth = await authenticate(req);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  // Сначала сохраняем в архив (обратимость), затем удаляем.
  const { data: row, error: selErr } = await supabaseAdmin
    .from('ratings')
    .select('*')
    .eq('player_id', playerId)
    .eq('user_id', auth.user.id)
    .maybeSingle();

  if (selErr) return res.status(500).json({ error: selErr.message });
  if (!row) return res.status(404).json({ error: 'Rating not found' });

  await archiveRatings([row], { deletedBy: auth.user.id });

  const { data, error } = await auth.client
    .from('ratings')
    .delete()
    .eq('player_id', playerId)
    .eq('user_id', auth.user.id)
    .select()
    .maybeSingle();

  if (error) return res.status(500).json({ error: error.message });

  void logAction({
    action: 'rating.delete',
    actorId: auth.user.id,
    entityType: 'rating',
    entityId: row.id,
    summary: `Удалена своя оценка игрока #${playerId}`,
    details: { playerId },
  });

  return res.status(200).json({ deleted: data });
});