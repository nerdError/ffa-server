import {
  createClient,
  type SupabaseClient,
  type User,
} from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY!;

export type AuthResult =
  | { ok: true; user: User; client: SupabaseClient }
  | { ok: false; status: number; error: string };

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
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) {
    return { ok: false, status: 401, error: 'Invalid or expired token' };
  }

  return { ok: true, user: data.user, client };
}

export function anonClient(): SupabaseClient {
  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}