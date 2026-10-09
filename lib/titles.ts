import { supabaseAdmin } from './supabase-admin.js';

export interface PlayerTitle {
  id: number;
  name: string;
  name_en?: string | null;
  color: string;
  size?: string;
}

/**
 * Прикрепляет массив титулов к списку игроков (добавляет поле `titles`).
 * Используется в карточке игрока и в оверлее — оба через get_player_with_stats.
 */
export async function attachTitles(
  players: Array<Record<string, unknown>>
): Promise<void> {
  const ids = players
    .map((p) => Number(p.id))
    .filter((n) => Number.isInteger(n) && n > 0);
  if (ids.length === 0) return;

  const { data, error } = await supabaseAdmin
    .from('player_titles')
    .select('player_id, titles(id, name, name_en, color, size)')
    .in('player_id', ids);

  if (error) {
    console.error('[titles] attach lookup failed:', error);
    for (const p of players) p.titles = [];
    return;
  }

  const byPlayer = new Map<number, PlayerTitle[]>();
  for (const row of data ?? []) {
    const t = row.titles as PlayerTitle | null;
    if (!t) continue;
    const list = byPlayer.get(row.player_id) ?? [];
    list.push(t);
    byPlayer.set(row.player_id, list);
  }

  for (const p of players) {
    p.titles = byPlayer.get(Number(p.id)) ?? [];
  }
}