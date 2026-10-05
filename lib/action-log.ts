import { supabaseAdmin } from './supabase-admin';

/**
 * Известные типы действий. Можно передать и произвольную строку.
 */
export type ActionType =
  | 'auth.signup'
  | 'auth.login'
  | 'auth.logout'
  | 'player.create'
  | 'player.rename'
  | 'player.aka'
  | 'player.delete'
  | 'player.link'
  | 'player.unlink'
  | 'rating.create'
  | 'rating.update'
  | 'rating.delete'
  | 'game.create'
  | 'game.update'
  | 'game.delete'
  | 'ref.create'
  | 'ref.update'
  | 'ref.delete'
  | 'role.grant'
  | 'role.revoke'
  | 'user.delete';

export interface LogActionInput {
  action: ActionType | string;
  /** id пользователя-автора действия (если есть) */
  actorId?: string | null;
  /** username автора (если известен — иначе подтянем из profiles) */
  actorUsername?: string | null;
  /** тип сущности: 'player' | 'game' | 'rating' | 'user' | ... */
  entityType?: string | null;
  entityId?: number | null;
  /** Человекочитаемое описание (по умолчанию — RU) */
  summary: string;
  /** Произвольные детали */
  details?: Record<string, unknown>;
}

/** Кэш username, чтобы не дёргать БД на каждое действие */
const usernameCache = new Map<string, string | null>();

async function resolveUsername(userId: string): Promise<string | null> {
  if (usernameCache.has(userId)) return usernameCache.get(userId) ?? null;

  try {
    const { data } = await supabaseAdmin
      .from('profiles')
      .select('username')
      .eq('user_id', userId)
      .maybeSingle();

    const username = data?.username ?? null;
    usernameCache.set(userId, username);
    return username;
  } catch {
    return null;
  }
}

/**
 * Пишет действие в таблицу action_log через service_role.
 * Никогда не бросает исключение — логирование не должно ломать основной запрос.
 */
export async function logAction(input: LogActionInput): Promise<void> {
  try {
    let actorUsername = input.actorUsername ?? null;
    if (!actorUsername && input.actorId) {
      actorUsername = await resolveUsername(input.actorId);
    }

    await supabaseAdmin.from('action_log').insert({
      action: input.action,
      actor_id: input.actorId ?? null,
      actor_username: actorUsername,
      entity_type: input.entityType ?? null,
      entity_id: input.entityId ?? null,
      summary: input.summary,
      details: input.details ?? {},
    });
  } catch (err) {
    console.error('[action-log] write failed:', err);
  }
}
