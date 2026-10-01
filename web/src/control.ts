import './styles/base.css';
import './styles/control.css';
import { apiRequest } from './api';
import type { PlayerWithStats, PlayersListResponse } from './types';
import { pickRaceColor } from './radar';
import { state } from './state';

console.log('[control] token:', state.token);   // временно

const viewModeSelect = document.getElementById('setting-view-mode') as HTMLSelectElement | null;
const openBtn = document.getElementById('btn-open-overlay') as HTMLAnchorElement | null;

viewModeSelect?.addEventListener('change', () => {
  void updateSettings({
    viewMode: viewModeSelect.value as 'average' | 'personal',
  });
});

interface OverlaySettings {
    animation: 'fade' | 'slide-left' | 'slide-right' | 'slide-up' | 'slide-down' | 'none';
    autoHide: boolean;
    autoHideDelay: number;
    viewMode: 'average' | 'personal';
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
    if (viewModeSelect) viewModeSelect.value = state.settings.viewMode ?? 'average';

    // Перерисовать список (для подсветки)
    renderPlayers(searchInput?.value ?? '');
}

async function fetchState(): Promise<void> {
    try {
        const stateRes = await apiRequest<OverlayState>('/api/control/state', {
            token: state.token,
        });

        renderState(stateRes);
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
            token: state.token,
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
            token: state.token,
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
            token: state.token,
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

  if (!state.token || !state.user) {
    sessionStorage.setItem('redirectAfterLogin', '/control');
    window.location.href = '/';
    return;
  }

  // 2. Проверка, что токен ещё валиден (и заодно обновление ролей)
  try {
    await apiRequest<{ user: any }>('/api/auth/me', {
      token: state.token,
    });
  } catch (err) {
    // Токен протух или невалиден — на главную
    console.warn('[control] auth check failed:', err);
    sessionStorage.setItem('redirectAfterLogin', '/control');
    window.location.href = '/';
    return;
  }

    setupOverlayPanel();   // ← НОВОЕ

    try {
        const res = await apiRequest<PlayersListResponse>('/api/players', {
            token: state.token,
        });
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
function buildOverlayUrl(token: string): string {
    const origin = window.location.origin;
    return `${origin}/overlay?token=${token}`;
}

/**
 * Настраивает панель с ссылкой для OBS.
 */
async function setupOverlayPanel(): Promise<void> {
    const overlayUrlInput = document.getElementById('overlay-url') as HTMLInputElement | null;
    const copyUrlBtn = document.getElementById('btn-copy-url') as HTMLButtonElement | null;
    const regenBtn = document.getElementById('btn-regenerate-token') as HTMLButtonElement | null;

    if (!overlayUrlInput || !copyUrlBtn || !regenBtn) return;

    let currentUrl = '';

    const updateUrl = (token: string): void => {
        currentUrl = `${window.location.origin}/overlay?token=${token}`;
        overlayUrlInput.value = currentUrl;
        if (openBtn) openBtn.href = currentUrl;   // ← обновляем href
    };

    // Загружаем (или создаём) токен
    try {
        const res = await apiRequest<{ token: string }>('/api/control/token', {
            token: state.token,
        });

        console.log('[control] token:', state.token);   // временно

        currentToken = res.token;
        updateUrl(res.token);
        // подписываемся на SSE
        connectControlSSE(res.token);
    } catch (err) {
        console.error('[control] failed to fetch overlay token:', err);
        overlayUrlInput.value = '— ошибка загрузки токена —';
    }

    overlayUrlInput.addEventListener('focus', () => overlayUrlInput.select());

    // Копирование
    copyUrlBtn.addEventListener('click', async () => {
        if (!currentUrl) return;
        try {
            await navigator.clipboard.writeText(currentUrl);
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
            overlayUrlInput.focus();
            overlayUrlInput.select();
            alert('Скопируйте ссылку вручную (Ctrl+C / Cmd+C)');
        }
    });

    // Перевыпуск
    regenBtn.addEventListener('click', async () => {
        const confirmed = confirm(
            'Перевыпустить токен?\n\n' +
            'Старая ссылка для OBS перестанет работать. ' +
            'Вам нужно будет обновить её в источнике OBS.'
        );
        if (!confirmed) return;

        try {
            regenBtn.disabled = true;
            const originalLabel = regenBtn.querySelector('.control-regen-label')?.textContent ?? '';
            const label = regenBtn.querySelector('.control-regen-label');
            if (label) label.textContent = 'Обновление…';

            const res = await apiRequest<{ token: string }>('/api/control/token/regenerate', {
                method: 'POST',
                token: state.token,
            });

            updateUrl(res.token);

            if (label) {
                label.textContent = 'Готово';
                setTimeout(() => {
                    label.textContent = originalLabel;
                }, 1500);
            }
        } catch (err) {
            alert('Не удалось перевыпустить токен: ' +
                (err instanceof Error ? err.message : String(err)));
        } finally {
            regenBtn.disabled = false;
        }
    });
}

let currentToken: string | null = null;

function connectControlSSE(token: string): void {
    const url = `/api/overlay/stream?token=${encodeURIComponent(token)}`;
    const es = new EventSource(url);

    es.addEventListener('message', (e) => {
        try {
            const state = JSON.parse(e.data) as OverlayState;
            renderState(state);
        } catch (err) {
            console.error('[control] failed to parse SSE message', err);
        }
    });

    es.addEventListener('error', () => {
        console.warn('[control] SSE error, reconnecting…');
    });
}

void init();