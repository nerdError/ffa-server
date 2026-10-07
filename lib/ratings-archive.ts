import { supabaseAdmin } from './supabase-admin.js';

interface ArchiveContext {
  deletedBy?: string | null;
  reason?: string | null;
}

/**
 * Копирует строки `ratings` в архив `ratings_archive` ПЕРЕД удалением.
 * best-effort: при ошибке логирует, но не ломает само удаление.
 */
export async function archiveRatings(
  rows: Array<Record<string, unknown>>,
  ctx: ArchiveContext = {}
): Promise<void> {
  if (!rows || rows.length === 0) return;

  // Подтягиваем имена (для удобного фильтра/отображения в архиве).
  const playerIds = [...new Set(rows.map((r) => Number(r.player_id)).filter(Boolean))];
  const userIds = [...new Set(rows.map((r) => r.user_id as string).filter(Boolean))];

  const playerName = new Map<number, string>();
  if (playerIds.length > 0) {
    const { data } = await supabaseAdmin
      .from('players')
      .select('id, name')
      .in('id', playerIds);
    for (const p of data ?? []) playerName.set(p.id, p.name);
  }

  const userName = new Map<string, string>();
  if (userIds.length > 0) {
    const { data } = await supabaseAdmin
      .from('profiles')
      .select('user_id, username')
      .in('user_id', userIds);
    for (const p of data ?? []) if (p.username) userName.set(p.user_id, p.username);
  }

  const payload = rows.map((r) => ({
    original_id: r.id,
    player_id: r.player_id,
    user_id: r.user_id,
    player_name: playerName.get(Number(r.player_id)) ?? null,
    user_name: userName.get(r.user_id as string) ?? null,
    race: r.race,
    adaptiveness: r.adaptiveness,
    greed: r.greed,
    survival: r.survival,
    turtle: r.turtle,
    aggression: r.aggression,
    variety: r.variety,
    created_at: r.created_at,
    updated_at: r.updated_at,
    deleted_by: ctx.deletedBy ?? null,
    reason: ctx.reason ?? null,
  }));

  const { error } = await supabaseAdmin.from('ratings_archive').insert(payload);
  if (error) {
    console.error('[ratings-archive] insert failed:', error);
  }
}