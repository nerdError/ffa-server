import type { AuthUser } from './types';

const STORAGE_TOKEN = 'token';
const STORAGE_REFRESH = 'refresh_token';
const STORAGE_USER = 'user';

interface AppState {
    token: string | null;
    refreshToken: string | null;
    user: AuthUser | null;
    currentPlayerId: number | null;
}

export const state: AppState = {
    token: localStorage.getItem(STORAGE_TOKEN),
    refreshToken: localStorage.getItem(STORAGE_REFRESH),
    user: readUser(),
    currentPlayerId: null,
};

function readUser(): AuthUser | null {
    const raw = localStorage.getItem(STORAGE_USER);
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw) as unknown;
        if (
            parsed &&
            typeof parsed === 'object' &&
            'id' in parsed &&
            'email' in parsed
        ) {
            return parsed as AuthUser;
        }
        return null;
    } catch {
        return null;
    }
}

export function saveSession(user: AuthUser, accessToken: string, refreshToken?: string): void {
    state.user = user;
    state.token = accessToken;
    localStorage.setItem(STORAGE_USER, JSON.stringify(user));
    localStorage.setItem(STORAGE_TOKEN, accessToken);

    if (refreshToken) {
        state.refreshToken = refreshToken;
        localStorage.setItem(STORAGE_REFRESH, refreshToken);
    }
}

export function clearSession(): void {
    state.user = null;
    state.token = null;
    state.refreshToken = null;
    localStorage.removeItem(STORAGE_USER);
    localStorage.removeItem(STORAGE_TOKEN);
    localStorage.removeItem(STORAGE_REFRESH);
}
