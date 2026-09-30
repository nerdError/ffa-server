import './styles/main.css';
import './styles/radar.css';
import './styles/card.css';

import { apiRequest, ApiRequestError } from './api';
import { state, clearSession, saveSession } from './state';
import { bindAuth } from './ui/auth';
import { bindCreatePlayer, loadPlayers } from './ui/players';
import { showScreen, openPlayerScreen, navigateTo } from './ui/player-detail';
import { PlayersListResponse } from './types';

// --- User box в шапке ---
export function renderUserBox(): void {
    const box = document.getElementById('user-box');
    if (!box) return;
    box.innerHTML = '';

    // Залогинен
    if (state.user) {
        const controlLink = document.createElement('a');
        controlLink.href = '/control';
        controlLink.className = 'topbar-link';
        controlLink.innerHTML = '🎬 <span class="btn-label">Режим стримера</span>';

        // Ник с бейджем роли
        const nameWrap = document.createElement('span');
        nameWrap.className = 'topbar-username';
        nameWrap.textContent = state.user.username || state.user.email;

        if (state.user.is_admin) {
            const badge = document.createElement('span');
            badge.className = 'role-badge role-badge--admin';
            badge.textContent = '★ ADMIN';
            nameWrap.appendChild(badge);
        } else if (state.user.is_moderator) {
            const badge = document.createElement('span');
            badge.className = 'role-badge role-badge--moderator';
            badge.textContent = '◆ MOD';
            nameWrap.appendChild(badge);
        }

        // Кнопка админ-меню — только для админов
        let adminBtn: HTMLAnchorElement | null = null;
        if (state.user.is_admin) {
            adminBtn = document.createElement('a');
            adminBtn.href = '/admin';
            adminBtn.className = 'topbar-link topbar-link--admin';
            adminBtn.innerHTML = '⚙ <span class="btn-label">Админ</span>';
        }

        const btn = document.createElement('button');
        btn.textContent = 'Выйти';
        btn.className = 'btn-secondary';
        btn.addEventListener('click', () => {
            void (async () => {
                try {
                    await apiRequest('/api/auth/logout', { method: 'POST', token: state.token });
                } catch { }
                clearSession();
                showScreen('screen-auth');   // ← СНАЧАЛА меняем экран
                renderUserBox();             // ← ПОТОМ перерисовываем шапку
            })();
        });

        box.append(controlLink);
        if (adminBtn) box.append(adminBtn);
        box.append(nameWrap, btn);
        return;
    }

    // Не залогинен — проверяем, какой экран активен
    const authScreen = document.getElementById('screen-auth');
    const isOnAuthScreen =
        authScreen && !authScreen.classList.contains('hidden');

    if (isOnAuthScreen) {
        // На экране логина — просто текст
        const span = document.createElement('span');
        span.className = 'topbar-guest';
        span.textContent = 'Вы не авторизованы';
        box.appendChild(span);
    } else {
        // На других экранах — кнопка «Войти»
        const loginBtn = document.createElement('button');
        loginBtn.type = 'button';
        loginBtn.className = 'topbar-login-btn';
        loginBtn.textContent = 'Войти';
        loginBtn.addEventListener('click', () => {
            navigateTo('screen-auth');
            renderUserBox();  // перерисовываем шапку под новый экран
        });
        box.appendChild(loginBtn);
    }
}

// --- Навигация ---
async function openPlayersScreen(): Promise<void> {
    navigateTo('screen-players');
    await loadPlayers({
        onOpenPlayer: (id, name) => {
            // Меняем URL на имя и открываем карточку
            window.history.pushState({}, '', `/?player=${encodeURIComponent(name)}`);
            void openPlayerScreen(id);
        },
    });
}

/**
 * Превращает параметр из URL в ID игрока.
 * Принимает "9" (число) или "Asfarion" (имя).
 * Возвращает null, если игрок не найден.
 */
async function resolvePlayerIdFromParam(
    param: string
): Promise<number | null> {
    const trimmed = param.trim();
    if (!trimmed) return null;

    // Если это число — сразу возвращаем
    const asNumber = Number(trimmed);
    if (Number.isInteger(asNumber) && asNumber > 0) {
        return asNumber;
    }

    // Иначе ищем по имени через список игроков
    try {
        const res = await apiRequest<PlayersListResponse>('/api/players');
        const found = res.players.find(
            (p) => p.name.toLowerCase() === trimmed.toLowerCase()
        );
        return found?.id ?? null;
    } catch {
        return null;
    }
}

// --- Инициализация ---
async function init(): Promise<void> {
    const urlParams = new URLSearchParams(window.location.search);
    const rawPlayerParam = urlParams.get('player');

    bindAuth({
        renderUserBox,
        onLoginSuccess: () => {
            void openPlayersScreen();
        },
    });

    bindCreatePlayer(() => {
        void openPlayersScreen();
    });

    const backBtn = document.getElementById('btn-back');
    backBtn?.addEventListener('click', () => {
        // Сбрасываем query-параметр player, оставляя только путь
        window.history.pushState({}, '', '/');
        void openPlayersScreen();
    });

    renderUserBox();
    navigateTo('screen-loading');

    const minLoaderMs = 300;
    const loaderStart = performance.now();
    const waitMinLoader = async (): Promise<void> => {
        const elapsed = performance.now() - loaderStart;
        if (elapsed < minLoaderMs) {
            await new Promise((r) => setTimeout(r, minLoaderMs - elapsed));
        }
    };

    let playerIdFromUrl: number | null = null;
    if (rawPlayerParam) {
        playerIdFromUrl = await resolvePlayerIdFromParam(rawPlayerParam);
    }

    // Не залогинен
    if (!state.token || !state.user) {
        await waitMinLoader();
        if (playerIdFromUrl !== null) {
            void openPlayerScreen(playerIdFromUrl);
        } else {
            navigateTo('screen-auth');
        }
        return;
    }

    // Залогинен — валидируем токен
    try {
        const me = await apiRequest<{
            user: { id: string; email: string; username: string | null; is_moderator: boolean, is_admin: boolean };
        }>('/api/auth/me', { token: state.token });

        saveSession(
            {
                id: me.user.id,
                email: me.user.email,
                username: me.user.username,
                is_moderator: me.user.is_moderator,
                is_admin: me.user.is_admin,
            },
            state.token
        );
        renderUserBox();

        await waitMinLoader();

        if (playerIdFromUrl !== null) {
            void openPlayerScreen(playerIdFromUrl);
        } else {
            void openPlayersScreen();
        }
    } catch (err) {
        await waitMinLoader();
        if (err instanceof ApiRequestError && err.status === 401) {
            clearSession();
        }
        renderUserBox();

        if (playerIdFromUrl !== null) {
            void openPlayerScreen(playerIdFromUrl);
        } else {
            navigateTo('screen-auth');
        }
    }

}

init();

const copyDiscord = document.getElementById('copy-discord') as HTMLButtonElement | null;

copyDiscord?.addEventListener('click', async () => {
    const originalText = copyDiscord.dataset.originalText ?? copyDiscord.textContent ?? '';
    // Сохраняем оригинальный текст один раз
    if (!copyDiscord.dataset.originalText) {
        copyDiscord.dataset.originalText = originalText;
    }

    try {
        await navigator.clipboard.writeText('nerderror');
        copyDiscord.textContent = '✓ Скопировано';
        copyDiscord.classList.add('is-copied');

        setTimeout(() => {
            copyDiscord.textContent = copyDiscord.dataset.originalText ?? originalText;
            copyDiscord.classList.remove('is-copied');
        }, 1500);
    } catch {
        // Fallback — если clipboard API недоступен
        const range = document.createRange();
        range.selectNodeContents(copyDiscord);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
    }
});

window.addEventListener('popstate', () => {
    const params = new URLSearchParams(window.location.search);
    const playerParam = params.get('player');

    if (!playerParam) {
        // Вернулись к списку
        void openPlayersScreen();
        return;
    }

    // Открываем карточку игрока
    void (async () => {
        const id = await resolvePlayerIdFromParam(playerParam);
        if (id !== null) {
            void openPlayerScreen(id);
        }
    })();
});

window.addEventListener('session:changed', () => {
    renderUserBox();
});