import { createClient } from '@supabase/supabase-js';
import { timeoutFetch } from './fetch-timeout.js';

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl) {
  throw new Error('SUPABASE_URL is not set');
}
if (!serviceRoleKey) {
  throw new Error(
    'SUPABASE_SERVICE_ROLE_KEY is not set. ' +
      'Add it to .env (Supabase Dashboard → Settings → API → service_role).'
  );
}

// Таймаут запросов к Supabase (мс). Для service_role — длиннее, т.к. через
// него идут тяжёлые операции (auth.admin.listUsers, массовые чтения).
const FETCH_TIMEOUT_MS = Number(process.env.SUPABASE_ADMIN_FETCH_TIMEOUT_MS ?? 60_000);

/**
 * Клиент Supabase с service_role ключом.
 * Обходит RLS — используется ТОЛЬКО на сервере для системных операций:
 *  - выдача/проверка токенов оверлея
 *  - административные действия
 *
 * НИКОГДА не передавайте этот клиент на фронтенд.
 */
export const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: timeoutFetch(FETCH_TIMEOUT_MS) },
});