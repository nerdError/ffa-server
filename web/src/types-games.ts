export interface GamePlayerEntry {
  player_id: number;
  player_name: string;
  player_aka: string | null;
  race: 'T' | 'Z' | 'P' | 'R';
  team: number | null;
  is_winner: boolean;
  eliminated_at: number | null;
}

export interface GameRef {
  id: number;
  name: string;
  slug?: string;
  aka?: string | null;
  is_team?: boolean;
}

export interface GameListItem {
  id: number;
  played_at: string;
  duration_min: number | null;
  format_id: number | null;
  format_name: string | null;
  format_slug: string | null;
  is_team: boolean;
  host_id: number | null;
  host_name: string | null;
  map_id: number | null;
  map_name: string | null;
  mod_name: string | null;
  player_count: number;
  winners: string[];
  participants: GamePlayerEntry[];
}

export interface GameFull {
  id: number;
  played_at: string;
  duration_min: number | null;
  notes: string | null;
  track_elim: boolean;   // ← должно быть
  created_by: string | null;
  created_at: string;
  updated_at: string;
  format: GameRef | null;
  host: GameRef | null;
  map: GameRef | null;
  mod: GameRef | null;
  players: GamePlayerEntry[];
}

export interface GamesListResponse {
  games: GameListItem[];
}

export interface GameResponse {
  game: GameFull;
}