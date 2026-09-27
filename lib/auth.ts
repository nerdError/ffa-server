import {
  createClient,
  type SupabaseClient,
  type User,
} from '@supabase/supabase-js';
import type { VercelRequest } from '@vercel/node';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY!;
// const formSignup = document.querySelector("#form-signup")

export type AuthResult =
  | { ok: true; user: User; client: SupabaseClient }
  | { ok: false; status: number; error: string };

/**
 * Извлекает Bearer-токен из заголовка Authorization,
 * проверяет его через Supabase Auth и возвращает:
 *  - user   — объект пользователя
 *  - client — клиент Supabase, ходящий в БД от имени пользователя (RLS увидит его)
 */
export async function authenticate(req: VercelRequest): Promise<AuthResult> {
  const header = req.headers.authorization ?? req.headers.Authorization;
  if (!header || typeof header !== 'string' || !header.startsWith('Bearer ')) {
    return { ok: false, status: 401, error: 'Missing Bearer token' };
  }

  const token = header.slice('Bearer '.length).trim();
  if (!token) {
    return { ok: false, status: 401, error: 'Empty token' };
  }

  const client = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) {
    return { ok: false, status: 401, error: 'Invalid or expired token' };
  }

  return { ok: true, user: data.user, client };
}

/**
 * Создаёт анонимный клиент (без токена).
 * Используется для публичных эндпоинтов.
 */
export function anonClient(): SupabaseClient {
  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}