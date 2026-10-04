import { Router } from 'express';
import { authenticate } from '../../lib/auth.js';
import { anonClient } from '../../lib/auth.js';

export const gamesRouter = Router();

// ============================================================
// Валидация участников
// ============================================================
interface GamePlayerInput {
  player_id: number;
  race: 'T' | 'Z' | 'P' | 'R';
  team?: number | null;
  is_winner?: boolean;
  eliminated_at?: number | null;
}

const VALID_RACES = ['T', 'Z', 'P', 'R'] as const;

function validatePlayers(input: unknown): string | null {
  if (!Array.isArray(input) || input.length === 0) {
    return 'players must be a non-empty array';
  }
  const seenIds = new Set<number>();
  for (const p of input as any[]) {
    if (!Number.isInteger(p?.player_id) || p.player_id <= 0) {
      return 'each player must have a valid player_id';
    }
    if (seenIds.has(p.player_id)) {
      return `duplicate player_id: ${p.player_id}`;
    }
    seenIds.add(p.player_id);
    if (!VALID_RACES.includes(p?.race)) {
      return `invalid race for player ${p.player_id}`;
    }
    if (p.is_winner !== undefined && typeof p.is_winner !== 'boolean') {
      return 'is_winner must be boolean';
    }
    if (p.eliminated_at !== undefined && p.eliminated_at !== null) {
      if (!Number.isInteger(p.eliminated_at) || p.eliminated_at <= 0) {
        return 'eliminated_at must be a positive integer';
      }
    }
  }
  return null;
}

// ============================================================
// GET /api/games — список игр (публичный)
// ============================================================
gamesRouter.get('/', async (req, res) => {
  const client = anonClient();

  const playerId = req.query.player_id ? Number(req.query.player_id) : null;
  const limit = Math.min(Number(req.query.limit ?? 50) || 50, 200);
  const offset = Math.max(Number(req.query.offset ?? 0) || 0, 0);

  const { data, error } = await client.rpc('get_games_list', {
    p_player_id: playerId,
    p_limit: limit,
    p_offset: offset,
  });

  if (error) {
    console.error('[games] list error:', error);
    return res.status(500).json({ error: 'DB error' });
  }

  res.json({ games: data ?? [] });
});

// ============================================================
// GET /api/games/:id — одна игра (публичный)
// ============================================================
gamesRouter.get('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'Invalid game id' });
  }

  const client = anonClient();
  const { data, error } = await client.rpc('get_game_with_players', { p_id: id });

  if (error) {
    console.error('[games] get error:', error);
    return res.status(500).json({ error: 'DB error' });
  }
  if (!data) {
    return res.status(404).json({ error: 'Game not found' });
  }

  res.json({ game: data });
});

// ============================================================
// POST /api/games — создать игру (модератор)
// ============================================================
gamesRouter.post('/', async (req, res) => {
  const auth = await authenticate(req);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  const { data: isMod } = await auth.client.rpc('is_moderator');
  if (!isMod) {
    return res.status(403).json({ error: 'Moderator access required' });
  }

  const {
    played_at,
    format_id,
    host_id,
    map_id,
    mod_id,
    duration_min,
    notes,
    players,
  } = req.body ?? {};

  // Валидация
  if (typeof played_at !== 'string' || !played_at) {
    return res.status(400).json({ error: 'played_at is required' });
  }

  const playersError = validatePlayers(players);
  if (playersError) {
    return res.status(400).json({ error: playersError });
  }

  // Проверим, что есть хотя бы один победитель
  const hasWinner = (players as GamePlayerInput[]).some((p) => p.is_winner === true);
  if (!hasWinner) {
    return res.status(400).json({ error: 'At least one player must be a winner' });
  }

  const { data, error } = await auth.client.rpc('create_game_with_players', {
    p_played_at: played_at,
    p_format_id: format_id ?? null,
    p_host_id:   host_id   ?? null,
    p_map_id:    map_id    ?? null,
    p_mod_id:    mod_id    ?? null,
    p_duration_min: duration_min ?? null,
    p_notes:     notes ?? null,
    p_players:   players,
  });

  if (error) {
    console.error('[games] create error:', error);
    return res.status(500).json({ error: 'DB error', details: error.message });
  }

  // Возвращаем полную игру с участниками
  const { data: fullGame, error: fetchError } = await auth.client.rpc(
    'get_game_with_players',
    { p_id: data }
  );

  if (fetchError) {
    // Игру создали, но не смогли прочитать — не критично
    return res.status(201).json({ game_id: data });
  }

  res.status(201).json({ game: fullGame });
});

// ============================================================
// PATCH /api/games/:id — обновить игру (модератор)
// ============================================================
gamesRouter.patch('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'Invalid game id' });
  }

  const auth = await authenticate(req);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  const { data: isMod } = await auth.client.rpc('is_moderator');
  if (!isMod) {
    return res.status(403).json({ error: 'Moderator access required' });
  }

  const {
    played_at,
    format_id,
    host_id,
    map_id,
    mod_id,
    duration_min,
    notes,
    players,
  } = req.body ?? {};

  if (typeof played_at !== 'string' || !played_at) {
    return res.status(400).json({ error: 'played_at is required' });
  }

  const playersError = validatePlayers(players);
  if (playersError) {
    return res.status(400).json({ error: playersError });
  }

  const hasWinner = (players as GamePlayerInput[]).some((p) => p.is_winner === true);
  if (!hasWinner) {
    return res.status(400).json({ error: 'At least one player must be a winner' });
  }

  const { error } = await auth.client.rpc('update_game_with_players', {
    p_game_id: id,
    p_played_at: played_at,
    p_format_id: format_id ?? null,
    p_host_id:   host_id   ?? null,
    p_map_id:    map_id    ?? null,
    p_mod_id:    mod_id    ?? null,
    p_duration_min: duration_min ?? null,
    p_notes:     notes ?? null,
    p_players:   players,
  });

  if (error) {
    console.error('[games] update error:', error);
    return res.status(500).json({ error: 'DB error', details: error.message });
  }

  // Возвращаем обновлённую игру
  const { data: fullGame } = await auth.client.rpc('get_game_with_players', {
    p_id: id,
  });

  res.json({ game: fullGame });
});

// ============================================================
// DELETE /api/games/:id — удалить игру (модератор)
// ============================================================
gamesRouter.delete('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'Invalid game id' });
  }

  const auth = await authenticate(req);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  const { data, error } = await auth.client
    .from('games')
    .delete()
    .eq('id', id)
    .select()
    .maybeSingle();

  if (error) {
    console.error('[games] delete error:', error);
    return res.status(500).json({ error: 'DB error' });
  }
  if (!data) {
    return res.status(404).json({ error: 'Game not found or not permitted' });
  }

  res.json({ deleted: data });
});