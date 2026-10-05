import './styles/base.css';
import './styles/player-card.css';
import './styles/card.css';
import './styles/overlay.css';
import { apiRequest } from './api';
import { buildPlayerCardElement } from './card';
import type { PlayerWithStats, PlayerResponse } from './types';

import { applyTranslations, onLocaleChange } from './i18n';

// При старте
applyTranslations();

// При смене языка
onLocaleChange(() => {
  applyTranslations();
  // и перерисовать всё, что генерится динамически
});

type AnimationType = 'fade' | 'slide-left' | 'slide-right' | 'slide-up' | 'slide-down' | 'none';

interface OverlaySettings {
    animation: AnimationType;
    autoHide: boolean;
    autoHideDelay: number;
    viewMode: 'average' | 'personal' | 'ghost';
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
    viewMode: 'average',
};
let autoHideTimer: number | null = null;
const playerCache = new Map<string, PlayerWithStats>();

async function fetchPlayer(id: number): Promise<PlayerWithStats | null> {
    // В personal-режиме кэш нужно сбрасывать при смене viewMode,
    // поэтому кэшируем с ключом, включающим режим
    const cacheKey = `${id}:${currentSettings.viewMode}`;
    if (playerCache.has(cacheKey)) {
        return playerCache.get(cacheKey) ?? null;
    }

    const token = getTokenFromUrl();
    if (!token) return null;

    try {
        const res = await apiRequest<PlayerResponse>(
            `/api/overlay/player/${id}?token=${encodeURIComponent(token)}`
        );
        playerCache.set(cacheKey, res.player);
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
    const prevViewMode = currentSettings.viewMode;
    currentSettings = state.settings;

    // Если режим показа изменился — сбрасываем кэш и перерисовываем
    if (prevViewMode !== state.settings.viewMode) {
        playerCache.clear();

        // Если что-то показывается — перерисовываем
        if (state.currentPlayerId !== null) {
            // Показываем "перезагрузку" — обнуляем текущий ID,
            // чтобы следующий блок кода вызвал showCard заново
            const idToReload = state.currentPlayerId;
            currentPlayerId = null;
            void showCard(idToReload);
            currentPlayerId = idToReload;
            return;
        }
    }

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

function connectSSE(token: string): void {
    const url = `/api/overlay/stream?token=${encodeURIComponent(token)}`;
    const es = new EventSource(url);

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

/**
 * Читает токен из URL: /overlay?token=abc123
 */
function getTokenFromUrl(): string | null {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    return token && token.length > 0 ? token : null;
}

async function init(): Promise<void> {
    const token = getTokenFromUrl();
    if (!token) {
        showError('Не указан токен оверлея. Получите ссылку в панели управления.');
        return;
    }

    // Загружаем начальное состояние
    try {
        const state = await apiRequest<OverlayState>(
            `/api/overlay/state?token=${encodeURIComponent(token)}`
        );
        handleState(state);
    } catch (err) {
        console.error('[overlay] failed to fetch initial state', err);
        showError('Неверный токен оверлея. Перевыпустите токен в панели управления.');
        return;
    }

    // Подключаем SSE
    connectSSE(token);
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

/**
 * Показывает сообщение об ошибке поверх оверлея (полезно для отладки).
 */
function showError(message: string): void {
    if (!root) return;
    root.innerHTML = `
    <div style="
      color: #e74c3c;
      font-family: 'Zekton', sans-serif;
      font-size: 20px;
      text-align: center;
      padding: 40px;
    ">${message}</div>
  `;
}

void init();