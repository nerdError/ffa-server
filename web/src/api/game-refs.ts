import { apiRequest } from '../api';

export type RefType = 'formats' | 'hosts' | 'maps' | 'mods';

export interface GameFormat {
  id: number;
  name: string;
  slug: string;
  sort_order: number;
  elo_weight: number;
  is_team: boolean;
  team_size: number;
  created_at: string;
}

export interface GameHost {
  id: number;
  name: string;
  aka: string | null;
  player_id: number | null;
  created_at: string;
}

export interface GameMap {
  id: number;
  name: string;
  /** Альтернативное название (локализация клиента). */
  alt_name: string | null;
  /** Мягкое удаление: карта скрыта из выбора, но игры на неё ссылаются. */
  deleted_at: string | null;
  created_at: string;
}

export interface GameMod {
  id: number;
  name: string;
  created_at: string;
}

export type RefItem = GameFormat | GameHost | GameMap | GameMod;

export async function listRefs<T extends RefItem>(refType: RefType): Promise<T[]> {
  const res = await apiRequest<{ items: T[] }>(`/api/game-refs/${refType}`);
  return res.items;
}

export async function createRef<T extends RefItem>(
  refType: RefType,
  body: Record<string, unknown>,
  token: string | null
): Promise<T> {
  const res = await apiRequest<{ item: T }>(`/api/game-refs/${refType}`, {
    method: 'POST',
    token,
    body,
  });
  return res.item;
}

export async function updateRef<T extends RefItem>(
  refType: RefType,
  id: number,
  body: Record<string, unknown>,
  token: string | null
): Promise<T> {
  const res = await apiRequest<{ item: T }>(`/api/game-refs/${refType}/${id}`, {
    method: 'PATCH',
    token,
    body,
  });
  return res.item;
}

export async function deleteRef(
  refType: RefType,
  id: number,
  token: string | null
): Promise<void> {
  await apiRequest(`/api/game-refs/${refType}/${id}`, {
    method: 'DELETE',
    token,
  });
}