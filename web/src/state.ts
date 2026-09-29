import type { AuthUser } from './types';

const STORAGE_TOKEN = 'token';
const STORAGE_USER = 'user';

interface AppState {
  token: string | null;
  user: AuthUser | null;
  currentPlayerId: number | null;
}

export const state: AppState = {
  token: localStorage.getItem(STORAGE_TOKEN),
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

export function saveSession(user: AuthUser, accessToken: string): void {
  state.user = user;
  state.token = accessToken;
  localStorage.setItem(STORAGE_USER, JSON.stringify(user));
  localStorage.setItem(STORAGE_TOKEN, accessToken);
}

export function clearSession(): void {
  state.user = null;
  state.token = null;
  localStorage.removeItem(STORAGE_USER);
  localStorage.removeItem(STORAGE_TOKEN);
}
