import './styles/base.css';
import './styles/control.css';
import { apiRequest } from './api';
import type { PlayerWithStats, PlayersListResponse } from './types';
import { pickRaceColor } from './radar';

interface OverlaySettings {
    animation: 'fade' | 'slide-left' | 'slide-right' | 'slide-up' | 'slide-down' | 'none';
    autoHide: boolean;
    autoHideDelay: number;
}

interface OverlayState {
    currentPlayerId: number | null;
    settings: OverlaySettings;
    version: number;
}

let cachedPlayers: PlayerWithStats[] = [];
let currentState: OverlayState | null = null;

// --- Ссылки на DOM ---
const playersBox = document.getElementById('control-players');
const searchInput = document.getElementById('control-search') as HTMLInputElement | null;
const statusBox = document.getElementById('control-status');
const currentBox = document.getElementById('control-current');
const hideBtn = document.getElementById('btn-hide');
const animationSelect = document.getElementById('setting-animation') as HTMLSelectElement | null;
const autoHideCheckbox = document.getElementById('setting-autohide') as HTMLInputElement | null;
const delayInput = document.getElementById('setting-delay') as HTMLInputElement | null;

function renderPlayers(filter: string): void {
    if (!playersBox) return;
    playersBox.innerHTML = '';

    const filtered = cachedPlayers.filter((p) =>
        p.name.toLowerCase().includes(filter.toLowerCase())
    );

    if (filtered.length === 0) {
        const message = cachedPlayers.length === 0
            ? 'Пока нет игроков с оценками'
            : 'Ничего не найдено';
        playersBox.innerHTML = `<p class="hint">${message}</p>`;
        return;
    }

    for (const p of filtered) {
        const color = pickRaceColor(p.races);

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'control-player-btn';
        btn.textContent = p.name;
        btn.style.setProperty('--race-color', color);

        if (currentState?.currentPlayerId === p.id) {
            btn.classList.add('is-active');
        }
        btn.addEventListener('click', () => {
            void showPlayer(p.id);
        });
        playersBox.appendChild(btn);
    }
}

function renderState(state: OverlayState): void {
    currentState = state;

    // Текущий игрок
    if (currentBox) {
        if (state.currentPlayerId === null) {
            currentBox.textContent = 'Ничего не показывается';
            currentBox.classList.remove('is-active');
        } else {
            const player = cachedPlayers.find((p) => p.id === state.currentPlayerId);
            if (player) {
                currentBox.textContent = `Сейчас: ${player.name}`;
                currentBox.classList.add('is-active');
            } else {
                currentBox.textContent = 'Сейчас показывается игрок, которого нет в списке';
                currentBox.classList.remove('is-active');
            }
        }
    }

    // Настройки
    if (animationSelect) animationSelect.value = state.settings.animation;
    if (autoHideCheckbox) autoHideCheckbox.checked = state.settings.autoHide;
    if (delayInput) delayInput.value = String(state.settings.autoHideDelay);

    // Перерисовать список (для подсветки)
    renderPlayers(searchInput?.value ?? '');
}

async function fetchState(): Promise<void> {
    try {
        const state = await apiRequest<OverlayState>('/api/control/state');
        renderState(state);
        if (statusBox) {
            statusBox.textContent = '● Подключено';
            statusBox.classList.remove('is-error');
            statusBox.classList.add('is-ok');
        }
    } catch (err) {
        if (statusBox) {
            statusBox.textContent = '● Нет связи';
            statusBox.classList.add('is-error');
            statusBox.classList.remove('is-ok');
        }
    }
}

async function showPlayer(playerId: number): Promise<void> {
    try {
        const res = await apiRequest<{ state: OverlayState }>('/api/control/show', {
            method: 'POST',
            body: { playerId },
        });
        renderState(res.state);
    } catch (err) {
        alert('Не удалось показать: ' + (err instanceof Error ? err.message : String(err)));
    }
}

async function hidePlayer(): Promise<void> {
    try {
        const res = await apiRequest<{ state: OverlayState }>('/api/control/hide', {
            method: 'POST',
        });
        renderState(res.state);
    } catch (err) {
        alert('Не удалось скрыть: ' + (err instanceof Error ? err.message : String(err)));
    }
}

async function updateSettings(patch: Partial<OverlaySettings>): Promise<void> {
    try {
        const res = await apiRequest<{ state: OverlayState }>('/api/control/settings', {
            method: 'POST',
            body: patch,
        });
        renderState(res.state);
    } catch (err) {
        alert('Не удалось сохранить настройки: ' + (err instanceof Error ? err.message : String(err)));
    }
}

// --- Навешиваем обработчики ---
hideBtn?.addEventListener('click', () => void hidePlayer());

searchInput?.addEventListener('input', () => {
    renderPlayers(searchInput.value);
});

animationSelect?.addEventListener('change', () => {
    void updateSettings({ animation: animationSelect.value as OverlaySettings['animation'] });
});

autoHideCheckbox?.addEventListener('change', () => {
    void updateSettings({ autoHide: autoHideCheckbox.checked });
});

delayInput?.addEventListener('change', () => {
    const delay = Number(delayInput.value);
    if (Number.isInteger(delay) && delay >= 1 && delay <= 600) {
        void updateSettings({ autoHideDelay: delay });
    }
});

// --- Первичная загрузка ---
async function init(): Promise<void> {
    setupOverlayPanel();   // ← НОВОЕ

    try {
        const res = await apiRequest<PlayersListResponse>('/api/players');
        cachedPlayers = res.players.filter((p) => p.vote_count > 0);
        renderPlayers('');
    } catch {
        if (playersBox) {
            playersBox.innerHTML = '<p class="hint">Не удалось загрузить игроков</p>';
        }
    }

    await fetchState();
}

// --- Ссылки на DOM (добавить к существующим) ---
const overlayUrlInput = document.getElementById('overlay-url') as HTMLInputElement | null;
const copyUrlBtn = document.getElementById('btn-copy-url') as HTMLButtonElement | null;

/**
 * Собирает URL оверлея на основе текущего origin.
 */
function buildOverlayUrl(): string {
    return `${window.location.origin}/overlay`;
}

/**
 * Настраивает панель с ссылкой для OBS.
 */
function setupOverlayPanel(): void {
    const url = buildOverlayUrl();
    if (overlayUrlInput) {
        overlayUrlInput.value = url;
        // Клик по полю — выделяем всё, чтобы легко скопировать вручную
        overlayUrlInput.addEventListener('focus', () => overlayUrlInput.select());
    }

    copyUrlBtn?.addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(url);
            // Визуальный фидбэк
            copyUrlBtn.classList.add('is-copied');
            const label = copyUrlBtn.querySelector('.control-copy-label');
            const icon = copyUrlBtn.querySelector('.control-copy-icon');
            const originalLabel = label?.textContent ?? '';
            const originalIcon = icon?.textContent ?? '';
            if (label) label.textContent = 'Скопировано';
            if (icon) icon.textContent = '✓';

            setTimeout(() => {
                copyUrlBtn.classList.remove('is-copied');
                if (label) label.textContent = originalLabel;
                if (icon) icon.textContent = originalIcon;
            }, 1800);
        } catch {
            // Fallback — выделить текст в поле
            if (overlayUrlInput) {
                overlayUrlInput.focus();
                overlayUrlInput.select();
                alert('Скопируйте ссылку вручную (Ctrl+C / Cmd+C)');
            }
        }
    });
}

void init();