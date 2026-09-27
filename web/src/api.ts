import type { ApiError } from './types';

/** Ошибка API с HTTP-статусом */
export class ApiRequestError extends Error {
  public readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
  }
}

type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

interface RequestOptions {
  method?: HttpMethod;
  body?: unknown;
  token?: string | null;
  signal?: AbortSignal;
}

/**
 * Обёртка над fetch. Автоматически:
 *  - добавляет Content-Type и Authorization
 *  - сериализует body в JSON
 *  - парсит ответ
 *  - бросает ApiRequestError при не-2xx
 */
export async function apiRequest<T>(
  path: string,
  options: RequestOptions = {}
): Promise<T> {
  const { method = 'GET', body, token, signal } = options;

  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const init: RequestInit = {
    method,
    headers,
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  if (signal !== undefined) init.signal = signal;

  const res = await fetch(path, init);

  let payload: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { error: text };
    }
  }

  if (!res.ok) {
    const message =
      payload && typeof payload === 'object' && 'error' in payload
        ? String((payload as ApiError).error)
        : `HTTP ${res.status}`;
    throw new ApiRequestError(message, res.status);
  }

  return payload as T;
}