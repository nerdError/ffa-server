import { Router } from 'express';
import { anonClient, authenticate } from '../../lib/auth.js';
import { logAction } from '../../lib/action-log.js';
import { supabaseAdmin } from '../../lib/supabase-admin.js';
import { getPlayerWithStatsMode, type StatsMode } from '../player-stats.js';
import { attachTitles } from '../../lib/titles.js';

export const playersRouter = Router();

function parseStatsMode(raw: unknown): StatsMode {
  return raw === 'ghost' || raw === 'personal' ? raw : 'average';
}

// GET /api/players — список со средними (публичный)
playersRouter.get('/', async (_req, res) => {
  const client = anonClient();
  const { data, error } = await client.rpc('get_players_with_stats');
  if (error) return res.status(500).json({ error: error.message });

  const userIds = [
    ...new Set(
      (data ?? [])
        .map((p: { user_id: string | null }) => p.user_id)
        .filter((id): id is string => !!id),
    ),
  ];

  const nameByUser = new Map<string, string>();
  if (userIds.length > 0) {
    const { data: profiles } = await client
      .from('profiles')
      .select('user_id, username')
      .in('user_id', userIds);
    for (const p of profiles ?? []) {
      if (p.username) nameByUser.set(p.user_id, p.username);
    }
  }

  const players = (data ?? []).map((p: { user_id: string | null }) => ({
    ...p,
    username: p.user_id ? nameByUser.get(p.user_id) ?? null : null,
  }));

  return res.status(200).json({ players });
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

  void logAction({
    action: 'player.create',
    actorId: auth.user.id,
    entityType: 'player',
    entityId: data.id,
    summary: `Добавлен игрок "${data.name}"`,
    details: { playerName: data.name },
  });

  return res.status(201).json({ player: data });
});
// GET /api/players/:id/stats?mode=average|personal|ghost
// Карточка игрока с выбранным источником оценок стиля.
playersRouter.get('/:id/stats', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'Invalid id' });
  }

  const mode = parseStatsMode(req.query.mode);

  let userId: string | null = null;
  if (mode === 'personal') {
    const auth = await authenticate(req);
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
    userId = auth.user.id;
  }

  try {
    const player = await getPlayerWithStatsMode(id, mode, userId);
    if (!player) return res.status(404).json({ error: 'Player not found' });
    return res.status(200).json({ player });
  } catch (err) {
    console.error('[players/stats] error:', err);
    return res.status(500).json({ error: 'DB error' });
  }
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
  const player = data[0];
  await attachTitles([player]);
  return res.status(200).json({ player });
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

  void logAction({
    action: 'player.delete',
    actorId: auth.user.id,
    entityType: 'player',
    entityId: data.id,
    summary: `Удалён игрок "${data.name}"`,
    details: { playerName: data.name },
  });

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

  void logAction({
    action: 'player.aka',
    actorId: auth.user.id,
    entityType: 'player',
    entityId: id,
    summary: `Изменён aka игрока "${data.name}": ${trimmed || '—'}`,
    details: { playerName: data.name, aka: trimmed || null },
  });

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

  void logAction({
    action: 'player.rename',
    actorId: auth.user.id,
    entityType: 'player',
    entityId: id,
    summary: `Игрок #${id} переименован в "${data.name}"`,
    details: { playerName: data.name },
  });

  res.json({ ok: true, player: data });
});

// ============================================================
// GET /api/players/:id/host-stats
// Статистика ведущего: если игрок привязан к ведущему (game_hosts.player_id),
// отдаём данные о проведённых им играх. Иначе { host: null }.
// ============================================================
playersRouter.get('/:id/host-stats', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'Invalid player id' });
  }

  // Ищем ведущего, привязанного к этому игроку
  const { data: hosts, error: hostsError } = await supabaseAdmin
    .from('game_hosts')
    .select('id, name, aka')
    .eq('player_id', id)
    .limit(1);
  if (hostsError) {
    console.error('[players/host-stats] hosts error:', hostsError);
    return res.status(500).json({ error: 'DB error' });
  }
  const host = hosts?.[0] ?? null;
  if (!host) return res.json({ host: null });

  const { data: games, error: gamesError } = await supabaseAdmin
    .from('games')
    .select('id, played_at, game_formats(name), game_maps(name), game_mods(name), game_players(player_id, players(name))')
    .eq('host_id', host.id)
    .order('played_at', { ascending: false })
    .limit(100);
  if (gamesError) {
    console.error('[players/host-stats] games error:', gamesError);
    return res.status(500).json({ error: 'DB error' });
  }

  const hosted = (games ?? []).map((g: any) => ({
    id: g.id,
    played_at: g.played_at,
    format_name: g.game_formats?.name ?? null,
    map_name: g.game_maps?.name ?? null,
    mod_name: g.game_mods?.name ?? null,
    player_names: (g.game_players ?? [])
      .map((p: any) => p.players?.name ?? null)
      .filter((n: unknown): n is string => typeof n === 'string'),
  }));

  const totalGames = hosted.length;
  const totalPlayers = hosted.reduce((sum, g) => sum + g.player_names.length, 0);
  const avgPlayers = totalGames ? Math.round((totalPlayers / totalGames) * 10) / 10 : 0;

  // Топ-5 карт/модов по встречаемости среди проведённых игр
  const topByCount = (key: (g: typeof hosted[number]) => string | null): { name: string; count: number }[] => {
    const counts = new Map<string, number>();
    for (const g of hosted) {
      const v = key(g);
      if (!v) continue;
      counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  };

  // Топ-5 игроков: считаем каждое участие в проведённых играх
  const playerCounts = new Map<string, number>();
  for (const g of hosted) {
    for (const name of g.player_names) {
      playerCounts.set(name, (playerCounts.get(name) ?? 0) + 1);
    }
  }
  const topPlayers = [...playerCounts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  res.json({
    host,
    stats: {
      total_games: totalGames,
      total_players: totalPlayers,
      avg_players: avgPlayers,
      last_played_at: hosted[0]?.played_at ?? null,
      top_maps: topByCount((g) => g.map_name),
      top_mods: topByCount((g) => g.mod_name),
      top_players: topPlayers,
    },
  });
});

// ============================================================
// GET /api/players/:id/game-stats
// ============================================================
playersRouter.get('/:id/game-stats', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'Invalid player id' });
  }

  const client = anonClient();
  const { data, error } = await client.rpc('get_player_game_stats', {
    p_player_id: id,
  });

  if (error) {
    console.error('[players/game-stats] error:', error);
    return res.status(500).json({ error: 'DB error' });
  }

  res.json({ stats: data });
});