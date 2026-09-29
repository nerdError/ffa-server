import type { Response } from 'express';

export type AnimationType =
  | 'fade'
  | 'slide-left'
  | 'slide-right'
  | 'slide-up'
  | 'slide-down'
  | 'none';

export interface OverlaySettings {
  animation: AnimationType;
  autoHide: boolean;
  autoHideDelay: number; // секунды
}

export interface OverlayState {
  currentPlayerId: number | null;
  settings: OverlaySettings;
  version: number;
}

const state: OverlayState = {
  currentPlayerId: null,
  settings: {
    animation: 'fade',
    autoHide: false,
    autoHideDelay: 10,
  },
  version: 0,
};

// Активные SSE-подключения
const subscribers = new Set<Response>();

/**
 * Отправляет всем подписчикам текущее состояние.
 */
function broadcast(): void {
  state.version += 1;
  const payload = JSON.stringify(state);

  for (const res of subscribers) {
    try {
      res.write(`data: ${payload}\n\n`);
    } catch (err) {
      // Клиент отвалился — удаляем
      subscribers.delete(res);
    }
  }
}

export function getState(): OverlayState {
  return state;
}

export function addSubscriber(res: Response): void {
  subscribers.add(res);
  res.on('close', () => {
    subscribers.delete(res);
  });
}

let autoHideTimer: NodeJS.Timeout | null = null;

function scheduleAutoHide(): void {
  if (autoHideTimer !== null) {
    clearTimeout(autoHideTimer);
    autoHideTimer = null;
  }

  if (!state.settings.autoHide || state.currentPlayerId === null) {
    return;
  }

  const delayMs = state.settings.autoHideDelay * 1000;
  autoHideTimer = setTimeout(() => {
    state.currentPlayerId = null;
    broadcast();
  }, delayMs);
}


export function showPlayer(playerId: number): void {
  state.currentPlayerId = playerId;
  broadcast();
  scheduleAutoHide();
}

export function hidePlayer(): void {
  state.currentPlayerId = null;
  if (autoHideTimer !== null) {
    clearTimeout(autoHideTimer);
    autoHideTimer = null;
  }
  broadcast();
}

export function updateSettings(settings: Partial<OverlaySettings>): void {
  state.settings = { ...state.settings, ...settings };
  broadcast();
  scheduleAutoHide();
}