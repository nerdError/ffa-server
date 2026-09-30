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

interface UserSlot {
    state: OverlayState;
    subscribers: Set<Response>;
    autoHideTimer: NodeJS.Timeout | null;
}

const DEFAULT_SETTINGS: OverlaySettings = {
    animation: 'fade',
    autoHide: false,
    autoHideDelay: 10,
};

/**
 * Состояние оверлея для каждого пользователя.
 * Ключ — user_id (uuid из Supabase).
 */
const slots = new Map<string, UserSlot>();

/**
 * Возвращает слот пользователя, создавая его при необходимости.
 */
function getOrCreateSlot(userId: string): UserSlot {
    if (typeof userId !== 'string' || !userId || userId === 'null' || userId === 'undefined') {
        throw new Error(`getOrCreateSlot called with invalid userId: ${userId}`);
    }

    let slot = slots.get(userId);
    if (!slot) {
        slot = {
            state: {
                currentPlayerId: null,
                settings: { ...DEFAULT_SETTINGS },
                version: 0,
            },
            subscribers: new Set(),
            autoHideTimer: null,
        };
        slots.set(userId, slot);
    }
    return slot;
}

/**
 * Отправляет текущее состояние всем SSE-подписчикам пользователя.
 */
function broadcast(userId: string): void {
    const slot = slots.get(userId);
    if (!slot) return;

    slot.state.version += 1;
    const payload = JSON.stringify(slot.state);

    for (const res of slot.subscribers) {
        try {
            res.write(`data: ${payload}\n\n`);
        } catch {
            // Клиент отвалился — удаляем
            slot.subscribers.delete(res);
        }
    }
}

/**
 * Планирует автоскрытие карточки для конкретного пользователя.
 * Сбрасывает старый таймер, если был.
 */
function scheduleAutoHide(userId: string): void {
    const slot = slots.get(userId);
    if (!slot) return;

    if (slot.autoHideTimer) {
        clearTimeout(slot.autoHideTimer);
        slot.autoHideTimer = null;
    }

    if (!slot.state.settings.autoHide || slot.state.currentPlayerId === null) {
        return;
    }

    const delayMs = slot.state.settings.autoHideDelay * 1000;
    slot.autoHideTimer = setTimeout(() => {
        slot.state.currentPlayerId = null;
        slot.autoHideTimer = null;
        broadcast(userId);
    }, delayMs);
}

// ============================================================
// Публичный API
// ============================================================

export function getState(userId: string): OverlayState {
    return getOrCreateSlot(userId).state;
}

export function addSubscriber(userId: string, res: Response): void {
    const slot = getOrCreateSlot(userId);
    slot.subscribers.add(res);
    res.on('close', () => {
        slot.subscribers.delete(res);
    });
}

export function showPlayer(userId: string, playerId: number): void {
    const slot = getOrCreateSlot(userId);
    slot.state.currentPlayerId = playerId;
    broadcast(userId);
    scheduleAutoHide(userId);
}

export function hidePlayer(userId: string): void {
    const slot = getOrCreateSlot(userId);

    if (slot.autoHideTimer) {
        clearTimeout(slot.autoHideTimer);
        slot.autoHideTimer = null;
    }

    slot.state.currentPlayerId = null;
    broadcast(userId);
}

export function updateSettings(
    userId: string,
    settings: Partial<OverlaySettings>
): void {
    const slot = getOrCreateSlot(userId);
    slot.state.settings = { ...slot.state.settings, ...settings };
    broadcast(userId);
    scheduleAutoHide(userId); // пересчитываем таймер
}

/**
 * Диагностика: количество активных пользователей.
 * Пригодится для отладки.
 */
export function debugStats(): { users: number; subscribers: number } {
  let total = 0;
  for (const slot of slots.values()) {
    total += slot.subscribers.size;
  }
  return { users: slots.size, subscribers: total };
}
