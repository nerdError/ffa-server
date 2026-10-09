import {
  createClient,
  type SupabaseClient,
  type User,
} from '@supabase/supabase-js';
import { timeoutFetch } from './fetch-timeout.js';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY!;

// Общий таймаут запросов к Supabase (мс).
const FETCH_TIMEOUT_MS = Number(process.env.SUPABASE_FETCH_TIMEOUT_MS ?? 15_000);

export type AuthResult =
  | { ok: true; user: User; client: SupabaseClient }
  | { ok: false; status: number; error: string };

// Кэш валидных токенов (getUser), чтобы не ходить в GoTrue на каждый запрос.
const userCache = new Map<string, { user: User; expires: number }>();
const USER_TTL_MS = 30_000;

// Кэш бан-статуса, чтобы не читать profiles на каждый авторизованный запрос.
const banCache = new Map<string, { banned: boolean; expires: number }>();
const BAN_TTL_MS = 15_000;

/** Единый анонимный клиент (для проверок до/вне пользовательского токена). */
const anonAuthClient = createClient(supabaseUrl, supabaseAnonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: timeoutFetch(FETCH_TIMEOUT_MS) },
});

/** Достаёт exp (мс) из JWT без проверки подписи — только чтобы не кэшировать дольше жизни токена. */
function jwtExpiryMs(token: string): number | null {
  const payload = token.split('.')[1];
  if (!payload) return null;
  try {
    const json = Buffer.from(payload, 'base64url').toString('utf8');
    const exp = (JSON.parse(json) as { exp?: number }).exp;
    return typeof exp === 'number' ? exp * 1000 : null;
  } catch {
    return null;
  }
}

/** Чистит просроченные токены, чтобы кэш не рос бесконтрольно. */
function pruneUserCache(now: number): void {
  if (userCache.size < 1000) return;
  for (const [token, entry] of userCache) {
    if (entry.expires <= now) userCache.delete(token);
  }
  if (userCache.size > 5000) userCache.clear();
}

/**
 * Возвращает пользователя по токену, кэшируя результат на короткий TTL.
 * Кэш не живёт дольше самого токена (учитываем exp из JWT).
 */
async function getTokenUser(
  token: string,
  client: SupabaseClient
): Promise<User | null> {
  const now = Date.now();
  const hit = userCache.get(token);
  if (hit && hit.expires > now) return hit.user;

  pruneUserCache(now);

  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) return null;

  const exp = jwtExpiryMs(token);
  const ttl = exp === null ? USER_TTL_MS : Math.min(USER_TTL_MS, exp - now - 5_000);
  if (ttl > 0) userCache.set(token, { user: data.user, expires: now + ttl });
  return data.user;
}

/**
 * Проверяет, не забанен ли аккаунт (profiles.banned_at), с коротким кэшем.
 * Используется и в authenticate(), и в login/refresh.
 */
export async function isUserBanned(userId: string): Promise<boolean> {
  const now = Date.now();
  const hit = banCache.get(userId);
  if (hit && hit.expires > now) return hit.banned;

  const { data } = await anonAuthClient
    .from('profiles')
    .select('banned_at')
    .eq('user_id', userId)
    .maybeSingle();

  const banned = Boolean(data?.banned_at);
  banCache.set(userId, { banned, expires: now + BAN_TTL_MS });
  return banned;
}

/** Сбрасывает кэши авторизации (вызывается при бане/разбане). */
export function clearAuthCache(): void {
  userCache.clear();
  banCache.clear();
}

/**
 * Извлекает Bearer-токен из заголовка Authorization.
 * Работает и с Express (req.headers.authorization), и с Vercel-функциями.
 */
export async function authenticate(req: {
  headers: Record<string, unknown>;
}): Promise<AuthResult> {
  const raw = req.headers.authorization ?? req.headers.Authorization;
  if (typeof raw !== 'string' || !raw.startsWith('Bearer ')) {
    return { ok: false, status: 401, error: 'Missing Bearer token' };
  }

  const token = raw.slice('Bearer '.length).trim();
  if (!token) {
    return { ok: false, status: 401, error: 'Empty token' };
  }

  const client = createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: { Authorization: `Bearer ${token}` },
      fetch: timeoutFetch(FETCH_TIMEOUT_MS),
    },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const user = await getTokenUser(token, client);
  if (!user) {
    return { ok: false, status: 401, error: 'Invalid or expired token' };
  }

  // Бан аккаунта: профиль с banned_at — отказываем во всех авторизованных запросах.
  if (await isUserBanned(user.id)) {
    return { ok: false, status: 403, error: 'Account is banned' };
  }

  return { ok: true, user, client };
}

export function anonClient(): SupabaseClient {
  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: timeoutFetch(FETCH_TIMEOUT_MS) },
  });
}
