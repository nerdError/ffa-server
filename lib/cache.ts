/**
 * Простой in-memory TTL-кэш для одиночного pm2-инстанса.
 *
 * Назначение — снять нагрузку на пул соединений Supabase: тяжёлые публичные
 * RPC (список игроков, лидерборд, справочники, титулы) кэшируются на короткий
 * TTL. Любая успешная запись через /api сбрасывает кэш (см. server/index.ts),
 * поэтому данные не «залипают».
 *
 * Одновременные одинаковые промахи дедуплицируются: параллельные запросы
 * ждут один общий поход в БД, а не создают новый.
 */
interface Entry {
  value: unknown;
  expires: number;
}

const store = new Map<string, Entry>();
const inflight = new Map<string, Promise<unknown>>();

// Счётчик «поколения» кэша: увеличивается при каждом сбросе. Загрузка,
// начавшаяся до сброса, не сохраняет результат (иначе запись в БД могла бы
// «затереться» устаревшими данными, прочитанными параллельно с записью).
let generation = 0;

export async function cached<T>(
  key: string,
  ttlMs: number,
  loader: () => Promise<T>
): Promise<T> {
  const now = Date.now();
  const hit = store.get(key);
  if (hit && hit.expires > now) return hit.value as T;

  const pending = inflight.get(key);
  if (pending) return pending as Promise<T>;

  const gen = generation;
  const promise = (async () => {
    try {
      const value = await loader();
      if (gen === generation) {
        store.set(key, { value, expires: Date.now() + ttlMs });
      }
      return value;
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, promise);
  return promise;
}

/**
 * Сбрасывает кэш. Без префикса — весь; с префиксом — только ключи,
 * начинающиеся с него (например, 'pub:').
 *
 * Также аннулирует незавершённые загрузки, чтобы их результат не попал в кэш
 * уже после сброса.
 */
export function clearCache(prefix?: string): void {
  generation++;

  if (!prefix) {
    store.clear();
    inflight.clear();
    return;
  }

  for (const key of [...store.keys()]) {
    if (key.startsWith(prefix)) store.delete(key);
  }
  for (const key of [...inflight.keys()]) {
    if (key.startsWith(prefix)) inflight.delete(key);
  }
}

// Периодическая чистка просроченных записей, чтобы память не росла.
const sweeper = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (entry.expires <= now) store.delete(key);
  }
}, 60_000);
sweeper.unref?.();
