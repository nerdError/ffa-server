import { Router } from 'express';
import { anonClient, authenticate } from '../../lib/auth.js';

export const playersRouter = Router();

// GET /api/players — список со средними (публичный)
playersRouter.get('/', async (_req, res) => {
  const client = anonClient();
  const { data, error } = await client.rpc('get_players_with_stats');
  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ players: data });
});

// POST /api/players — создание (только авторизованные)
playersRouter.post('/', async (req, res) => {
  const auth = await authenticate(req);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  // Проверяем, что пользователь — модератор
  const { data: isMod } = await auth.client.rpc('is_moderator');
  if (!isMod) {
    return res.status(403).json({ error: 'Only moderators can add players' });
  }

  const name = req.body?.name;
  if (typeof name !== 'string' || name.trim().length === 0) {
    return res.status(400).json({ error: 'name is required' });
  }
  if (name.trim().length > 100) {
    return res.status(400).json({ error: 'name is too long (max 100 chars)' });
  }

  const { data, error } = await auth.client
    .from('players')
    .insert({ name: name.trim(), created_by: auth.user.id })
    .select()
    .single();

  if (error) {
    const status = error.code === '23505' ? 409 : 500;
    return res.status(status).json({ error: error.message });
  }

  return res.status(201).json({ player: data });
});
// GET /api/players/:id — один игрок со средними (публичный)
playersRouter.get('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'Invalid id' });
  }

  const client = anonClient();
  const { data, error } = await client.rpc('get_player_with_stats', {
    p_id: id,
  });
  if (error) return res.status(500).json({ error: error.message });
  if (!data || data.length === 0) {
    return res.status(404).json({ error: 'Player not found' });
  }
  return res.status(200).json({ player: data[0] });
});

// DELETE /api/players/:id — только модераторы (RLS проверит)
playersRouter.delete('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'Invalid id' });
  }

  const auth = await authenticate(req);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  const { data, error } = await auth.client
    .from('players')
    .delete()
    .eq('id', id)
    .select()
    .maybeSingle();

  if (error) return res.status(500).json({ error: error.message });
  if (!data) {
    return res.status(404).json({ error: 'Player not found or not permitted' });
  }
  return res.status(200).json({ deleted: data });
});

// ============================================================
// PATCH /api/players/:id/aka
// Обновить aka игрока (только модератор/админ)
// ============================================================
playersRouter.patch('/:id/aka', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'Invalid player id' });
  }

  const auth = await authenticate(req);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  // Проверка: модератор или админ
  const { data: isMod } = await auth.client.rpc('is_moderator');
  if (!isMod) {
    return res.status(403).json({ error: 'Moderator access required' });
  }

  const aka = req.body?.aka;
  if (aka !== null && typeof aka !== 'string') {
    return res.status(400).json({ error: 'aka must be a string or null' });
  }

  const trimmed = typeof aka === 'string' ? aka.trim() : null;
  if (trimmed && trimmed.length > 100) {
    return res.status(400).json({ error: 'aka is too long (max 100)' });
  }

  const { data, error } = await auth.client
    .from('players')
    .update({ aka: trimmed || null })
    .eq('id', id)
    .select()
    .maybeSingle();

  if (error) {
    console.error('[players/aka] error:', error);
    return res.status(500).json({ error: 'DB error' });
  }
  if (!data) {
    return res.status(404).json({ error: 'Player not found' });
  }

  res.json({ ok: true, player: data });
});

// ============================================================
// PATCH /api/players/:id/name
// Переименовать игрока (только модератор/админ)
// ============================================================
playersRouter.patch('/:id/name', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'Invalid player id' });
  }

  const auth = await authenticate(req);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  const { data: isMod } = await auth.client.rpc('is_moderator');
  if (!isMod) {
    return res.status(403).json({ error: 'Moderator access required' });
  }

  const name = req.body?.name;
  if (typeof name !== 'string') {
    return res.status(400).json({ error: 'name is required' });
  }

  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return res.status(400).json({ error: 'name cannot be empty' });
  }
  if (trimmed.length > 100) {
    return res.status(400).json({ error: 'name is too long (max 100)' });
  }

  const { data, error } = await auth.client
    .from('players')
    .update({ name: trimmed })
    .eq('id', id)
    .select()
    .maybeSingle();

  if (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Player with this name already exists' });
    }
    console.error('[players/name] error:', error);
    return res.status(500).json({ error: 'DB error' });
  }
  if (!data) {
    return res.status(404).json({ error: 'Player not found' });
  }

  res.json({ ok: true, player: data });
});