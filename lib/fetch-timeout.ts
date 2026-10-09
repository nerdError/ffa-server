/**
 * fetch с жёстким таймаутом. Не даёт запросам к Supabase «висеть»
 * бесконечно: по истечении таймаута запрос прерывается (AbortController),
 * и вызывающий код получает ошибку вместо зависания на 15+ секунд.
 *
 * Таймаут задаётся вызывающим кодом (см. SUPABASE_FETCH_TIMEOUT_MS).
 */
export function timeoutFetch(timeoutMs: number): typeof fetch {
  return ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    // Если у вызывающего уже есть signal — объединяем его с нашим,
    // чтобы отмена снаружи тоже прерывала запрос.
    const outer = init?.signal;
    if (outer) {
      if (outer.aborted) {
        controller.abort();
      } else {
        outer.addEventListener('abort', () => controller.abort(), { once: true });
      }
    }

    return fetch(input, { ...init, signal: controller.signal }).finally(() => {
      clearTimeout(timer);
    });
  }) as typeof fetch;
}
