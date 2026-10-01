// ============================================================
// Типы данных, соответствующие ответам API
// ============================================================

export type Race = 'T' | 'Z' | 'P' | 'R';

export const RACES: readonly Race[] = ['T', 'Z', 'P', 'R'] as const;

export type StatKey =
  | 'adaptiveness'
  | 'greed'
  | 'survival'
  | 'turtle'
  | 'aggression'
  | 'variety';

export const STAT_KEYS: readonly StatKey[] = [
  'adaptiveness',
  'greed',
  'survival',
  'turtle',
  'aggression',
  'variety',
] as const;

/** Игрок со средними значениями (ответ GET /api/players и /api/players/:id) */
export interface PlayerWithStats {
  id: number;
  name: string;
  aka: string | null;
  races: Race[];
  dominant_race: Race | null;   // ← НОВОЕ
  vote_count: number;
  adaptiveness: number | null;
  greed: number | null;
  survival: number | null;
  turtle: number | null;
  aggression: number | null;
  variety: number | null;
}

/** Оценка в публичном списке — теперь с username */
export interface Rating {
  id: number;
  user_id: string;
  username: string;
  is_moderator: boolean;
  is_admin: boolean;
  race: Race;
  adaptiveness: number;
  greed: number;
  survival: number;
  turtle: number;
  aggression: number;
  variety: number;
  created_at: string;
  updated_at: string;
}

/** Своя оценка (ответ GET /api/players/:id/my-rating) */
export interface MyRating {
  id: number;
  race: Race;
  adaptiveness: number;
  greed: number;
  survival: number;
  turtle: number;
  aggression: number;
  variety: number;
  created_at: string;
  updated_at: string;
}

/** Тело запроса на создание/обновление оценки */
export interface RatingInput {
  race: Race;
  adaptiveness: number;
  greed: number;
  survival: number;
  turtle: number;
  aggression: number;
  variety: number;
}

/** Пользователь (ответ login/signup) */
export interface AuthUser {
  id: string;
  email: string;
  username?: string | null;
  is_moderator?: boolean;
  is_admin?: boolean;
}

export interface LoginResponse {
  user: AuthUser;
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

export interface SignupResponse {
  user: (AuthUser & { username: string }) | null;
  session: { access_token: string; refresh_token: string; expires_at: number } | null;
  note?: string;
}
// --- Ответы API ---

export interface PlayersListResponse {
  players: PlayerWithStats[];
}

export interface PlayerResponse {
  player: PlayerWithStats;
}

export interface RatingsListResponse {
  ratings: Rating[];
}

export interface MyRatingResponse {
  rating: MyRating | null;
}

export interface RatingResponse {
  rating: Rating;
}

export interface ApiError {
  error: string;
}