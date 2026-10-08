import { Router } from 'express';
import { authenticate } from '../../lib/auth.js';
import { supabaseAdmin } from '../../lib/supabase-admin.js';
import { logAction } from '../../lib/action-log.js';

export const titlesRouter = Router();

const TITLE_SIZES = ['small', 'medium', 'large', 'xlarge'] as const;
type TitleSize = (typeof TITLE_SIZES)[number];

function isTitleSize(value: unknown): value is TitleSize {
  return typeof value === 'string' && (TITLE_SIZES as readonly string[]).includes(value);
}

/**
 * Middleware: только для админов (запись/редактирование титулов).
 */
async function requireAdmin(req: any, res: any): Promise<{ ok: true; userId: string } | { ok: false }> {
  const auth = await authenticate(req);
  if (!auth.ok) {
    res.status(auth.status).json({ error: auth.error });
    return { ok: false };
  }
  const { data: isAdmin } = await auth.client.rpc('is_admin');
  if (!isAdmin) {
    res.status(403).json({ error: 'Admin access required' });
    return { ok: false };
  }
  return { ok: true, userId: auth.user.id };
}

// ============================================================
// GET /api/titles — список титулов (публичный)
// ============================================================
titlesRouter.get('/', async (_req, res) => {
  const { data, error } = await supabaseAdmin
    .from('titles')
    .select('*')
    .order('name', { ascending: true });

  if (error) {
    console.error('[titles] list error:', error);
    return res.status(500).json({ error: 'DB error' });
  }

  const titles = data ?? [];
  const ids = titles.map((t) => t.id);

  // Для админки: какие игроки имеют каждый титул
  const byTitle = new Map<number, number[]>();
  if (ids.length > 0) {
    const { data: links, error: linksErr } = await supabaseAdmin
      .from('player_titles')
      .select('title_id, player_id')
      .in('title_id', ids);
    if (linksErr) {
      console.error('[titles] links error:', linksErr);
    } else {
      for (const row of links ?? []) {
        const list = byTitle.get(row.title_id) ?? [];
        list.push(row.player_id);
        byTitle.set(row.title_id, list);
      }
    }
  }

  const items = titles.map((t) => ({
    ...t,
    player_ids: byTitle.get(t.id) ?? [],
  }));

  res.json({ items });
});

// ============================================================
// POST /api/titles — создать титул (админ)
// { name, color }
// ============================================================
titlesRouter.post('/', async (req, res) => {
  const check = await requireAdmin(req, res);
  if (!check.ok) return;

  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  const color = typeof req.body?.color === 'string' ? req.body.color.trim() : '';
  const size = req.body?.size ?? 'small';

  if (!name) return res.status(400).json({ error: 'name is required' });
  if (name.length > 60) return res.status(400).json({ error: 'name is too long (max 60)' });
  if (!color) return res.status(400).json({ error: 'color is required' });
  if (!isTitleSize(size)) return res.status(400).json({ error: 'invalid size' });

  const { data, error } = await supabaseAdmin
    .from('titles')
    .insert({ name, color, size })
    .select()
    .single();

  if (error) {
    console.error('[titles] create error:', error);
    return res.status(500).json({ error: 'DB error' });
  }

  void logAction({
    action: 'title.create',
    actorId: check.userId,
    entityType: 'title',
    entityId: data.id,
    summary: `Создан титул "${data.name}"`,
    details: { name: data.name, color: data.color },
  });

  res.status(201).json({ item: data });
});

// ============================================================
// PATCH /api/titles/:id — обновить титул (админ)
// { name?, color? }
// ============================================================
titlesRouter.patch('/:id', async (req, res) => {
  const check = await requireAdmin(req, res);
  if (!check.ok) return;

  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'Invalid title id' });
  }

  const payload: Record<string, unknown> = {};
  if (req.body?.name !== undefined) {
    const name = String(req.body.name).trim();
    if (!name) return res.status(400).json({ error: 'name cannot be empty' });
    if (name.length > 60) return res.status(400).json({ error: 'name is too long (max 60)' });
    payload.name = name;
  }
  if (req.body?.color !== undefined) {
    const color = String(req.body.color).trim();
    if (!color) return res.status(400).json({ error: 'color cannot be empty' });
    payload.color = color;
  }
  if (req.body?.size !== undefined) {
    if (!isTitleSize(req.body.size)) return res.status(400).json({ error: 'invalid size' });
    payload.size = req.body.size;
  }

  if (Object.keys(payload).length === 0) {
    return res.status(400).json({ error: 'No fields provided' });
  }

  const { data, error } = await supabaseAdmin
    .from('titles')
    .update(payload)
    .eq('id', id)
    .select()
    .maybeSingle();

  if (error) {
    console.error('[titles] update error:', error);
    return res.status(500).json({ error: 'DB error' });
  }
  if (!data) return res.status(404).json({ error: 'Title not found' });

  void logAction({
    action: 'title.update',
    actorId: check.userId,
    entityType: 'title',
    entityId: id,
    summary: `Изменён титул "${data.name}"`,
    details: payload,
  });

  res.json({ item: data });
});

// ============================================================
// DELETE /api/titles/:id — удалить титул (админ)
// ============================================================
titlesRouter.delete('/:id', async (req, res) => {
  const check = await requireAdmin(req, res);
  if (!check.ok) return;

  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'Invalid title id' });
  }

  const { data: row, error: selErr } = await supabaseAdmin
    .from('titles')
    .select('id, name')
    .eq('id', id)
    .maybeSingle();
  if (selErr) {
    console.error('[titles] delete select error:', selErr);
    return res.status(500).json({ error: 'DB error' });
  }
  if (!row) return res.status(404).json({ error: 'Title not found' });

  // Сначала снимаем титул со всех игроков
  await supabaseAdmin.from('player_titles').delete().eq('title_id', id);

  const { error } = await supabaseAdmin.from('titles').delete().eq('id', id);
  if (error) {
    console.error('[titles] delete error:', error);
    return res.status(500).json({ error: 'DB error' });
  }

  void logAction({
    action: 'title.delete',
    actorId: check.userId,
    entityType: 'title',
    entityId: id,
    summary: `Удалён титул "${row.name}"`,
    details: { name: row.name },
  });

  res.json({ ok: true });
});

// ============================================================
// POST /api/titles/:id/players — назначить титул игроку (админ)
// { playerId }
// ============================================================
titlesRouter.post('/:id/players', async (req, res) => {
  const check = await requireAdmin(req, res);
  if (!check.ok) return;

  const titleId = Number(req.params.id);
  const playerId = Number(req.body?.playerId);
  if (!Number.isInteger(titleId) || titleId <= 0) {
    return res.status(400).json({ error: 'Invalid title id' });
  }
  if (!Number.isInteger(playerId) || playerId <= 0) {
    return res.status(400).json({ error: 'Invalid player id' });
  }

  // Проверяем существование титула и игрока
  const { data: titleRow } = await supabaseAdmin
    .from('titles')
    .select('id')
    .eq('id', titleId)
    .maybeSingle();
  if (!titleRow) return res.status(404).json({ error: 'Title not found' });

  const { data: playerRow } = await supabaseAdmin
    .from('players')
    .select('id, name')
    .eq('id', playerId)
    .maybeSingle();
  if (!playerRow) return res.status(404).json({ error: 'Player not found' });

  const { error } = await supabaseAdmin
    .from('player_titles')
    .upsert({ title_id: titleId, player_id: playerId }, { onConflict: 'title_id,player_id' });

  if (error) {
    console.error('[titles] assign error:', error);
    return res.status(500).json({ error: 'DB error' });
  }

  const { data: titleName } = await supabaseAdmin
    .from('titles')
    .select('name')
    .eq('id', titleId)
    .maybeSingle();

  void logAction({
    action: 'title.assign',
    actorId: check.userId,
    entityType: 'title',
    entityId: titleId,
    summary: `Титул "${titleName?.name ?? titleId}" выдан игроку "${playerRow.name}"`,
    details: { titleId, playerId, playerName: playerRow.name },
  });

  res.json({ ok: true });
});

// ============================================================
// DELETE /api/titles/:id/players/:playerId — снять титул (админ)
// ============================================================
titlesRouter.delete('/:id/players/:playerId', async (req, res) => {
  const check = await requireAdmin(req, res);
  if (!check.ok) return;

  const titleId = Number(req.params.id);
  const playerId = Number(req.params.playerId);
  if (!Number.isInteger(titleId) || titleId <= 0) {
    return res.status(400).json({ error: 'Invalid title id' });
  }
  if (!Number.isInteger(playerId) || playerId <= 0) {
    return res.status(400).json({ error: 'Invalid player id' });
  }

  const { data: playerRow } = await supabaseAdmin
    .from('players')
    .select('id, name')
    .eq('id', playerId)
    .maybeSingle();

  const { error } = await supabaseAdmin
    .from('player_titles')
    .delete()
    .eq('title_id', titleId)
    .eq('player_id', playerId);

  if (error) {
    console.error('[titles] unassign error:', error);
    return res.status(500).json({ error: 'DB error' });
  }

  const { data: titleName } = await supabaseAdmin
    .from('titles')
    .select('name')
    .eq('id', titleId)
    .maybeSingle();

  void logAction({
    action: 'title.unassign',
    actorId: check.userId,
    entityType: 'title',
    entityId: titleId,
    summary: `Титул "${titleName?.name ?? titleId}" снят с игрока "${playerRow?.name ?? playerId}"`,
    details: { titleId, playerId },
  });

  res.json({ ok: true });
});