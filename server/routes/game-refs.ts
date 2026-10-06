import { Router } from 'express';
import { authenticate } from '../../lib/auth.js';
import { supabaseAdmin } from '../../lib/supabase-admin.js';
import { logAction } from '../../lib/action-log.js';

export const gameRefsRouter = Router();

const REF_LABELS: Record<string, string> = {
  formats: 'формат',
  hosts: 'ведущий',
  maps: 'карта',
  mods: 'мод',
};

// ============================================================
// Конфигурация справочников
// ============================================================
type RefType = 'formats' | 'hosts' | 'maps' | 'mods';

interface RefConfig {
  table: string;
  minRole: 'moderator' | 'admin';
  /** Поля, которые можно задавать при создании/обновлении */
  fields: string[];
  /** Поле для сортировки в списке */
  orderBy: string;
}

const REFS: Record<RefType, RefConfig> = {
  formats: {
    table: 'game_formats',
    minRole: 'admin',
    fields: ['name', 'slug', 'sort_order', 'elo_weight'],
    orderBy: 'sort_order',
  },
  hosts: {
    table: 'game_hosts',
    minRole: 'admin',
    fields: ['name', 'aka', 'player_id'],
    orderBy: 'name',
  },
  maps: {
    table: 'game_maps',
    minRole: 'moderator',
    fields: ['name', 'alt_name', 'deleted_at'],
    orderBy: 'name',
  },
  mods: {
    table: 'game_mods',
    minRole: 'moderator',
    fields: ['name'],
    orderBy: 'name',
  },
};

function isRefType(value: string): value is RefType {
  return value === 'formats' || value === 'hosts' || value === 'maps' || value === 'mods';
}

/**
 * Middleware: проверяет, что refType валиден, кладёт конфиг в req.
 */
gameRefsRouter.use('/:refType', (req, res, next) => {
  const { refType } = req.params;
  if (!isRefType(refType)) {
    return res.status(404).json({ error: 'Unknown ref type' });
  }
  (req as any).refConfig = REFS[refType];
  (req as any).refType = refType;
  next();
});

/**
 * Проверка прав: модератор или админ.
 */
async function checkRole(
  req: any,
  res: any,
  minRole: 'moderator' | 'admin'
): Promise<{ ok: true; client: any; userId: string } | { ok: false }> {
  const auth = await authenticate(req);
  if (!auth.ok) {
    res.status(auth.status).json({ error: auth.error });
    return { ok: false };
  }

  if (minRole === 'admin') {
    const { data: isAdmin } = await auth.client.rpc('is_admin');
    if (!isAdmin) {
      res.status(403).json({ error: 'Admin access required' });
      return { ok: false };
    }
  } else {
    const { data: isMod } = await auth.client.rpc('is_moderator');
    if (!isMod) {
      res.status(403).json({ error: 'Moderator access required' });
      return { ok: false };
    }
  }

  return { ok: true, client: auth.client, userId: auth.user.id };
}

/**
 * Фильтрует body, оставляя только разрешённые поля.
 */
function pickFields(body: any, allowed: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of allowed) {
    if (body[key] !== undefined) {
      out[key] = body[key];
    }
  }
  return out;
}

/** Приводит alt_name к непустой строке или null. */
function normalizeAltName(payload: Record<string, unknown>): void {
  if (payload.alt_name !== undefined) {
    const v = typeof payload.alt_name === 'string' ? payload.alt_name.trim() : '';
    payload.alt_name = v || null;
  }
}

// ============================================================
// GET /api/game-refs/:refType — список (публичный)
// ============================================================
gameRefsRouter.get('/:refType', async (req, res) => {
  const config: RefConfig = (req as any).refConfig;

  const { data, error } = await supabaseAdmin
    .from(config.table)
    .select('*')
    .order(config.orderBy, { ascending: true });

  if (error) {
    console.error(`[game-refs] ${config.table} list error:`, error);
    return res.status(500).json({ error: 'DB error' });
  }

  res.json({ items: data ?? [] });
});

// ============================================================
// POST /api/game-refs/:refType — создать
// ============================================================
gameRefsRouter.post('/:refType', async (req, res) => {
  const config: RefConfig = (req as any).refConfig;
  const refType: RefType = (req as any).refType;
  const check = await checkRole(req, res, config.minRole);
  if (!check.ok) return;

  const payload = pickFields(req.body ?? {}, config.fields);

  if (Object.keys(payload).length === 0) {
    return res.status(400).json({ error: 'No valid fields provided' });
  }
  if (typeof payload.name !== 'string' || !(payload.name as string).trim()) {
    return res.status(400).json({ error: 'name is required' });
  }
  payload.name = String(payload.name).trim();
  normalizeAltName(payload);

  // Карты: если такое название уже есть и карта была мягко удалена — восстанавливаем,
  // а не создаём дубликат (unique по name не даст вставить).
  if (refType === 'maps') {
    const { data: allMaps } = await check.client
      .from('game_maps')
      .select('id, name, alt_name, deleted_at');

    const target = String(payload.name).trim().toLowerCase();
    const existing = (allMaps ?? []).find(
      (m: { name: string }) => m.name.trim().toLowerCase() === target
    );

    if (existing) {
      if (!existing.deleted_at) {
        return res.status(409).json({ error: 'Item with this name already exists' });
      }
      const update: Record<string, unknown> = { deleted_at: null };
      if (payload.alt_name !== undefined) update.alt_name = payload.alt_name;
      const { data: revived, error: reviveError } = await check.client
        .from('game_maps')
        .update(update)
        .eq('id', existing.id)
        .select()
        .single();
      if (reviveError) {
        console.error('[game-refs] map revive error:', reviveError);
        return res.status(500).json({ error: 'DB error' });
      }
      void logAction({
        action: 'ref.create',
        actorId: check.userId,
        entityType: refType,
        entityId: revived.id,
        summary: `Восстановлена карта: "${revived.name}"`,
        details: { refType, name: revived.name },
      });
      return res.status(201).json({ item: revived });
    }
  }

  const { data, error } = await check.client
    .from(config.table)
    .insert(payload)
    .select()
    .single();

  if (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Item with this name already exists' });
    }
    console.error(`[game-refs] ${config.table} insert error:`, error);
    return res.status(500).json({ error: 'DB error' });
  }

  void logAction({
    action: 'ref.create',
    actorId: check.userId,
    entityType: refType,
    entityId: data.id,
    summary: `Добавлен справочник (${REF_LABELS[refType]}): "${data.name}"`,
    details: { refType, name: data.name },
  });

  res.status(201).json({ item: data });
});

// ============================================================
// PATCH /api/game-refs/:refType/:id — обновить
// ============================================================
gameRefsRouter.patch('/:refType/:id', async (req, res) => {
  const config: RefConfig = (req as any).refConfig;
  const refType: RefType = (req as any).refType;
  const check = await checkRole(req, res, config.minRole);
  if (!check.ok) return;

  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'Invalid id' });
  }

  const payload = pickFields(req.body ?? {}, config.fields);

  if (Object.keys(payload).length === 0) {
    return res.status(400).json({ error: 'No valid fields provided' });
  }
  if (payload.name !== undefined) {
    if (typeof payload.name !== 'string' || !(payload.name as string).trim()) {
      return res.status(400).json({ error: 'name cannot be empty' });
    }
    payload.name = String(payload.name).trim();
  }
  normalizeAltName(payload);

  const { data, error } = await check.client
    .from(config.table)
    .update(payload)
    .eq('id', id)
    .select()
    .maybeSingle();

  if (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Item with this name already exists' });
    }
    console.error(`[game-refs] ${config.table} update error:`, error);
    return res.status(500).json({ error: 'DB error' });
  }
  if (!data) {
    return res.status(404).json({ error: 'Item not found' });
  }

  // Если обновили формат (например, elo_weight) — пересчитываем Elo
  if (refType === 'formats') {
    const { error: recalcError } = await check.client.rpc('recalculate_all_ratings');
    if (recalcError) {
      console.error('[game-refs] recalculate after format update failed:', recalcError);
      // Не возвращаем ошибку клиенту — формат обновлён успешно.
      // Просто логируем.
    }
  }

  void logAction({
    action: 'ref.update',
    actorId: check.userId,
    entityType: refType,
    entityId: id,
    summary: `Изменён справочник (${REF_LABELS[refType]}): "${data.name}"`,
    details: { refType, name: data.name },
  });

  res.json({ item: data });
});

// ============================================================
// DELETE /api/game-refs/:refType/:id — удалить
// ============================================================
gameRefsRouter.delete('/:refType/:id', async (req, res) => {
  const config: RefConfig = (req as any).refConfig;
  const refType: RefType = (req as any).refType;
  const check = await checkRole(req, res, config.minRole);
  if (!check.ok) return;

  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'Invalid id' });
  }

  // Карты удаляем мягко: строку не убираем, чтобы игры сохраняли ссылку и
  // название (игровые карточки смогут показать «карта удалена»).
  const result = refType === 'maps'
    ? await check.client
        .from('game_maps')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .maybeSingle()
    : await check.client
        .from(config.table)
        .delete()
        .eq('id', id)
        .select()
        .maybeSingle();

  const { data, error } = result;

  if (error) {
    console.error(`[game-refs] ${config.table} delete error:`, error);
    return res.status(500).json({ error: 'DB error' });
  }
  if (!data) {
    return res.status(404).json({ error: 'Item not found' });
  }

  // Если удалили формат — пересчитываем Elo
  if (refType === 'formats') {
    const { error: recalcError } = await check.client.rpc('recalculate_all_ratings');
    if (recalcError) {
      console.error('[game-refs] recalculate after format delete failed:', recalcError);
    }
  }

  void logAction({
    action: 'ref.delete',
    actorId: check.userId,
    entityType: refType,
    entityId: id,
    summary: `Удалён справочник (${REF_LABELS[refType]}): "${data.name}"`,
    details: { refType, name: data.name },
  });

  res.json({ deleted: data });
});