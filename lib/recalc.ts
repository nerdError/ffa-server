import { createClient } from '@supabase/supabase-js';
import { timeoutFetch } from './fetch-timeout.js';

const supabaseUrl = process.env.SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/**
 * Отдельный клиент для тяжёлого пересчёта рейтингов. Пересчёт идёт по всем
 * играм сразу, поэтому допускаем длинный таймаут (но всё равно ограниченный),
 * чтобы не держать соединение бесконечно.
 */
const heavyClient = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: {
    fetch: timeoutFetch(Number(process.env.SUPABASE_RECALC_TIMEOUT_MS ?? 120_000)),
  },
});

let inFlight: Promise<void> | null = null;
let queued = false;

/**
 * Пересчитывает Elo/активность по всем играм (RPC recalculate_all_ratings).
 *
 * Вызовы «склеиваются»: пока идёт пересчёт, повторные вызовы не запускают
 * новый, а ждут текущий и при необходимости инициируют ещё один проход, чтобы
 * учесть записи, пришедшие во время пересчёта. Это не даёт параллельным
 * тяжёлым пересчётам забить пул соединений Supabase и заблокировать чтения.
 *
 * Ошибки логируются и не бросаются наружу (как и раньше) — сама игра/справочник
 * уже сохранены, рейтинг можно пересчитать позже.
 */
export function recalculateAllRatings(): Promise<void> {
  if (inFlight) {
    queued = true;
    return inFlight;
  }

  inFlight = (async () => {
    try {
      do {
        queued = false;
        const { error } = await heavyClient.rpc('recalculate_all_ratings');
        if (error) {
          console.error('[recalc] recalculate_all_ratings failed:', error);
        }
      } while (queued);
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}
