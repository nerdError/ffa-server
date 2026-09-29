import './styles/base.css';
import './styles/card.css';
import './styles/overlay.css';
import { apiRequest } from './api';
import { buildPlayerCardElement } from './card';
import type { PlayerWithStats, PlayerResponse } from './types';

type AnimationType = 'fade' | 'slide-left' | 'slide-right' | 'slide-up' | 'slide-down' | 'none';

interface OverlaySettings {
    animation: AnimationType;
    autoHide: boolean;
    autoHideDelay: number;
}

interface OverlayState {
    currentPlayerId: number | null;
    settings: OverlaySettings;
    version: number;
}

const root = document.getElementById('root');
let currentPlayerId: number | null = null;
let currentSettings: OverlaySettings = {
    animation: 'fade',
    autoHide: false,
    autoHideDelay: 10,
};
let autoHideTimer: number | null = null;
const playerCache = new Map<number, PlayerWithStats>();

async function fetchPlayer(id: number): Promise<PlayerWithStats | null> {
    if (playerCache.has(id)) return playerCache.get(id) ?? null;
    try {
        const res = await apiRequest<PlayerResponse>(`/api/players/${id}`);
        playerCache.set(id, res.player);
        return res.player;
    } catch {
        return null;
    }
}

/**
 * Возвращает класс анимации появления/исчезновения.
 */
function animClass(
    animation: AnimationType,
    direction: 'in' | 'out'
): string {
    if (animation === 'none') return 'anim-none';
    return `anim-${animation}-${direction}`;
}

/**
 * Показывает карточку игрока с анимацией появления.
 */
async function showCard(playerId: number): Promise<void> {
  if (!root) return;

  const oldScaler = root.querySelector('.pc-scaler');
  if (oldScaler) oldScaler.remove();

  const player = await fetchPlayer(playerId);
  if (!player) return;

  const scaler = document.createElement('div');
  scaler.className = 'pc-scaler';

  const card = buildPlayerCardElement(player, { compact: false });
  card.classList.add(animClass(currentSettings.animation, 'in'));

  scaler.appendChild(card);
  root.appendChild(scaler);
  fitCardToScreen(scaler);

  // Никаких таймеров — автоскрытие на сервере!
}

/**
 * Скрывает карточку с анимацией исчезновения.
 */
function hideCard(): void {
  if (!root) return;
  const scaler = root.querySelector('.pc-scaler') as HTMLElement | null;
  if (!scaler) return;
  const card = scaler.querySelector('.player-card') as HTMLElement | null;
  if (!card) return;

    // Отменяем автоскрытие
    if (autoHideTimer !== null) {
        clearTimeout(autoHideTimer);
        autoHideTimer = null;
    }

    // Убираем класс появления, ставим — исчезновения
    card.classList.remove(
        'anim-fade-in',
        'anim-slide-left-in',
        'anim-slide-right-in',
        'anim-slide-up-in',
        'anim-slide-down-in',
        'anim-none'
    );

    const outClass = animClass(currentSettings.animation, 'out');
    card.classList.add(outClass);

    // Удаляем карточку после завершения анимации
    card.addEventListener(
        'animationend',
        () => {
            card.remove();
        },
        { once: true }
    );
}

/**
 * Обрабатывает новое состояние с сервера.
 */
function handleState(state: OverlayState): void {
    currentSettings = state.settings;

    // Игрок не изменился — ничего не делаем (важно для смены настроек!)
    if (state.currentPlayerId === currentPlayerId) {
        return;
    }

    if (state.currentPlayerId === null) {
        hideCard();
    } else {
        void showCard(state.currentPlayerId);
    }

    currentPlayerId = state.currentPlayerId;
}

function connectSSE(): void {
    const es = new EventSource('/api/overlay/stream');

    es.addEventListener('message', (e) => {
        try {
            const state = JSON.parse(e.data) as OverlayState;
            handleState(state);
        } catch (err) {
            console.error('[overlay] failed to parse SSE message', err);
        }
    });

    es.addEventListener('error', () => {
        console.warn('[overlay] SSE error, reconnecting…');
    });
}

async function init(): Promise<void> {
    try {
        const state = await apiRequest<OverlayState>('/api/overlay/state');
        handleState(state);
    } catch (err) {
        console.warn('[overlay] failed to fetch initial state', err);
    }

    connectSSE();
}

const CARD_BASE_W = 960;
const CARD_BASE_H = 540;

function fitCardToScreen(scaler: HTMLElement): void {
  const update = () => {
    const scale = Math.min(
      window.innerWidth / CARD_BASE_W,
      window.innerHeight / CARD_BASE_H
    );
    scaler.style.transform = `scale(${scale})`;
  };
  update();
  window.addEventListener('resize', update);
}

void init();