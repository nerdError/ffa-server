import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Supabase env vars missing. Run "vercel env pull .env.development.local"'
  );
}

/**
 * Публичный клиент Supabase с anon-ключом.
 * Используется для регистрации/логина и для анонимных запросов на чтение.
 */
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,        // ← обязательно, чтобы сессия сохранялась
    autoRefreshToken: true,      // ← включает автообновление
    detectSessionInUrl: true,    // ← нужно для подтверждения email и OAuth
  },
});