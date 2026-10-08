import { supabaseAdmin } from '../lib/supabase-admin.js';
import { attachTitles } from '../lib/titles.js';

export type StatsMode = 'average' | 'personal' | 'ghost';

const STAT_KEYS = [
  'adaptiveness',
  'greed',
  'survival',
  'turtle',
  'aggression',
  'variety',
] as const;

type StatKey = (typeof STAT_KEYS)[number];

interface RatingRow extends Record<StatKey, number> {
  race: string;
}

interface StyleOverride {
  races: string[];
  vote_count: number;
  adaptiveness: number | null;
  greed: number | null;
  survival: number | null;
  turtle: number | null;
  aggression: number | null;
  variety: number | null;
}

const EMPTY_STYLE: StyleOverride = {
  races: [],
  vote_count: 0,
  adaptiveness: null,
  greed: null,
  survival: null,
  turtle: null,
  aggression: null,
  variety: null,
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Сводит набор оценок в средний стиль игрока.
 * Пустой набор — пустой стиль (карточка покажет «нет данных»).
 */
function aggregate(rows: RatingRow[]): StyleOverride {
  if (rows.length === 0) return { ...EMPTY_STYLE };

  const races = [...new Set(rows.map((r) => r.race))];

  const avg = (key: StatKey): number => {
    const sum = rows.reduce((acc, r) => acc + Number(r[key]), 0);
    return round2(sum / rows.length);
  };

  return {
    races,
    vote_count: rows.length,
    adaptiveness: avg('adaptiveness'),
    greed: avg('greed'),
    survival: avg('survival'),
    turtle: avg('turtle'),
    aggression: avg('aggression'),
    variety: avg('variety'),
  };
}

/**
 * Пользователи с ролью GHOST — их оценки формируют отдельную среднюю.
 */
async function getGhostUserIds(): Promise<string[]> {
  const { data, error } = await supabaseAdmin
    .from('user_roles')
    .select('user_id')
    .eq('role', 'ghost');

  if (error) {
    console.error('[player-stats] ghost users lookup failed:', error);
    return [];
  }

  return (data ?? []).map((r) => r.user_id);
}

/**
 * Отсекает пользователей с can_rate=false — их оценки не должны
 * влиять на среднюю (в гостевом режиме и в общих средних).
 */
async function filterEnabledUserIds(userIds: string[]): Promise<string[]> {
  if (userIds.length === 0) return [];

  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('user_id, can_rate')
    .in('user_id', userIds);

  if (error) {
    console.error('[player-stats] profiles lookup failed:', error);
    return userIds;
  }

  return (data ?? [])
    .filter((p) => p.can_rate !== false)
    .map((p) => p.user_id);
}

async function fetchRatings(
  playerId: number,
  userIds: string[]
): Promise<RatingRow[]> {
  if (userIds.length === 0) return [];

  const select = `race, ${STAT_KEYS.join(', ')}`;
  const { data, error } = await supabaseAdmin
    .from('ratings')
    .select(select)
    .eq('player_id', playerId)
    .in('user_id', userIds);

  if (error) {
    console.error('[player-stats] ratings lookup failed:', error);
    return [];
  }

  return (data ?? []) as unknown as RatingRow[];
}

/**
 * Возвращает карточку игрока (полный PlayerWithStats) с учётом режима:
 *  - average  — глобальная средняя (RPC get_player_with_stats);
 *  - personal — оценка конкретного пользователя (userId);
 *  - ghost    — средняя только по пользователям с ролью GHOST.
 *
 * Метрики (elo, игры, победы, winrate, активность) всегда берутся из
 * общей статистики; переопределяются только раса и 6 параметров стиля.
 */
export async function getPlayerWithStatsMode(
  playerId: number,
  mode: StatsMode,
  userId?: string | null
): Promise<Record<string, unknown> | null> {
  const { data, error } = await supabaseAdmin.rpc('get_player_with_stats', {
    p_id: playerId,
  });

  if (error) throw error;

  const base = (data?.[0] ?? null) as Record<string, unknown> | null;
  if (!base) return null;

  let result: Record<string, unknown>;
  if (mode === 'average') {
    result = base;
  } else if (mode === 'personal') {
    if (!userId) {
      result = { ...base, ...EMPTY_STYLE };
    } else {
      const rows = await fetchRatings(playerId, [userId]);
      result = { ...base, ...aggregate(rows) };
    }
  } else {
    // ghost
    const ghostIds = await getGhostUserIds();
    const enabledGhostIds = await filterEnabledUserIds(ghostIds);
    const rows = await fetchRatings(playerId, enabledGhostIds);
    result = { ...base, ...aggregate(rows) };
  }

  // Титулы игрока — одинаковы во всех режимах (карточка сайта и оверлей)
  await attachTitles([result]);
  return result;
}
