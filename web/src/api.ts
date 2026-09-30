import { state, clearSession, saveSession } from './state';
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

    let res = await fetch(path, init);

    // Если 401 — пробуем обновить токен и повторить
    // if (
    //     res.status === 401 &&
    //     options.token &&
    //     state.refreshToken &&
    //     !path.includes('/api/auth/refresh')   // ← ЗАЩИТА ОТ РЕКУРСИИ
    // ) {
    //     const newToken = await refreshAccessToken();
    //     if (newToken) {
    //         // Повторяем запрос с новым токеном
    //         const retryHeaders: Record<string, string> = { ...headers };
    //         retryHeaders['Authorization'] = `Bearer ${newToken}`;
    //         res = await fetch(path, { ...init, headers: retryHeaders });
    //     }
    // }

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

let isRefreshing = false;
let refreshPromise: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
    if (!state.refreshToken) return null;

    // Если уже идёт обновление — ждём его
    if (isRefreshing && refreshPromise) return refreshPromise;

    isRefreshing = true;
    refreshPromise = (async () => {
        try {
            const res = await fetch('/api/auth/refresh', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ refresh_token: state.refreshToken }),
            });

            if (!res.ok) {
                clearSession();
                return null;
            }

            const data = await res.json();
            if (data.access_token && data.user) {
                saveSession(
                    { id: data.user.id, email: data.user.email },
                    data.access_token,
                    data.refresh_token
                );
                return data.access_token;
            }
            return null;
        } catch {
            return null;
        } finally {
            isRefreshing = false;
            refreshPromise = null;
        }
    })();

    return refreshPromise;
}