import './styles/main.css';
import './styles/radar.css';
import './styles/card.css';

import { apiRequest, ApiRequestError } from './api';
import { state, clearSession, saveSession } from './state';
import { bindAuth } from './ui/auth';
import { bindCreatePlayer, loadPlayers } from './ui/players';
import { showScreen, openPlayerScreen, navigateTo } from './ui/player-detail';
import { PlayersListResponse } from './types';
import { Locale, onLocaleChange, t } from './i18n';

import { applyTranslations } from './i18n';

import { getLocale, setLocale } from './i18n';

document.querySelectorAll<HTMLButtonElement>('.lang-btn').forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.lang === getLocale());
    btn.addEventListener('click', () => {
        const lang = btn.dataset.lang as 'ru' | 'en';
        setLocale(lang);
    });
});

// При старте
applyTranslations();

onLocaleChange((locale) => {
    // 1. Применяем переводы к статичному HTML
    applyTranslations();

    // 2. Перерисовываем шапку (там динамические кнопки)
    renderUserBox();

    // 3. Перерисовываем текущий экран — но аккуратно, чтобы не потерять состояние
    // Например, если открыт список игроков — перерисуем таблицу
    // Пока можем просто перерисовать, если экран активен
    const activeScreen = document.querySelector('.screen:not(.hidden)');
    if (activeScreen?.id === 'screen-players') {
        // Здесь можно вызвать перерисовку списка — но это уже следующий этап.
        // Пока оставим как есть: локализация списка будет добавляться отдельно.
    }

    document.querySelectorAll<HTMLButtonElement>('.lang-btn').forEach((btn) => {
        btn.classList.toggle('is-active', btn.dataset.lang === locale);
    });
});

function setupLangSwitch(): void {
    const buttons = document.querySelectorAll<HTMLButtonElement>('.lang-btn');

    const updateActive = (locale: Locale): void => {
        buttons.forEach((btn) => {
            btn.classList.toggle('is-active', btn.dataset.lang === locale);
        });
    };

    buttons.forEach((btn) => {
        btn.addEventListener('click', () => {
            const lang = btn.dataset.lang as Locale | undefined;
            if (lang === 'ru' || lang === 'en') {
                setLocale(lang);
            }
        });
    });

    // Устанавливаем активную при старте
    updateActive(getLocale());

    // Подписываемся на изменение языка из других мест (например, если кто-то вызовет setLocale программно)
    onLocaleChange(updateActive);
}

// --- User box в шапке ---
export function renderUserBox(): void {
    const box = document.getElementById('user-box');
    if (!box) return;
    box.innerHTML = '';

    // Залогинен
    if (state.user) {
        const reviewBtn = document.createElement('button');
        reviewBtn.type = 'button';
        reviewBtn.className = 'topbar-link topbar-link--review';
        reviewBtn.innerHTML = `✓ <span class="btn-label">${t('players.review_all')}</span>`;
        reviewBtn.addEventListener('click', () => {
            void startReviewMode();
        });

        const controlLink = document.createElement('a');
        controlLink.href = '/control';
        controlLink.className = 'topbar-link';
        controlLink.innerHTML = `🎬 <span class="btn-label">${t('topbar.streamer_mode')}</span>`;

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
            adminBtn.innerHTML = `⚙ <span class="btn-label">${t("topbar.admin")}</span>`;
        }

        const btn = document.createElement('button');
        btn.textContent = t("common.logout");
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

        box.append(reviewBtn);
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
        span.setAttribute("data-i18n", 'topbar.guest');
        span.textContent = t("topbar.guest");
        applyTranslations();
        box.appendChild(span);
    } else {
        // На других экранах — кнопка «Войти»
        const loginBtn = document.createElement('button');
        loginBtn.type = 'button';
        loginBtn.className = 'topbar-login-btn';
        loginBtn.textContent = t("common.login");
        loginBtn.addEventListener('click', () => {
            navigateTo('screen-auth');
            renderUserBox();  // перерисовываем шапку под новый экран
        });
        box.appendChild(loginBtn);
    }

    applyTranslations();
}

// --- Навигация ---
async function openPlayersScreen(): Promise<void> {
    navigateTo('screen-players');
    await loadPlayers({
        onOpenPlayer: (id, name) => {
            // Меняем URL на имя и открываем карточку
            state.reviewMode = null;   // ← сброс режима
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

    state.onBackToList = () => {
        state.reviewMode = null;
        window.history.pushState({}, '', '/');
        void openPlayersScreen();
    };

    bindAuth({
        renderUserBox,
        onLoginSuccess: () => {
            // В onLoginSuccess или после успешного логина:
            const redirect = sessionStorage.getItem('redirectAfterLogin');
            if (redirect) {
                sessionStorage.removeItem('redirectAfterLogin');
                window.location.href = redirect;
                return;
            }

            void openPlayersScreen();
        },
    });

    bindCreatePlayer(() => {
        void openPlayersScreen();
    });

    const backBtn = document.getElementById('btn-back');
    backBtn?.addEventListener('click', () => {
        state.reviewMode = null;
        // Сбрасываем query-параметр player, оставляя только путь
        window.history.pushState({}, '', '/');
        void openPlayersScreen();
    });

    setupLangSwitch();
    applyTranslations();   // применить переводы ко всем data-i18n в HTML
    renderUserBox();
    showScreen('screen-loading');

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
            // navigateTo('screen-auth');
            void openPlayersScreen();
        }
        return;
    }

    // Залогинен — валидируем токен
    try {

        console.log("apiRequest('/api/auth/me')");

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
            //  navigateTo('screen-auth');
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
            // navigateTo('screen-auth');
            void openPlayersScreen();
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
        copyDiscord.textContent = '✓ ' + t('common.copied');
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

const copyEmail = document.getElementById('copy-email') as HTMLButtonElement | null;

copyEmail?.addEventListener('click', async () => {
    const originalText = copyEmail.dataset.originalText ?? copyEmail.textContent ?? '';
    // Сохраняем оригинальный текст один раз
    if (!copyEmail.dataset.originalText) {
        copyEmail.dataset.originalText = originalText;
    }

    try {
        await navigator.clipboard.writeText('admin@sc2-ffa-league.ru');
        copyEmail.textContent = '✓ ' + t('common.copied');
        copyEmail.classList.add('is-copied');

        setTimeout(() => {
            copyEmail.textContent = copyEmail.dataset.originalText ?? originalText;
            copyEmail.classList.remove('is-copied');
        }, 1500);
    } catch {
        // Fallback — если clipboard API недоступен
        const range = document.createRange();
        range.selectNodeContents(copyEmail);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
    }
});

const copyCard = document.getElementById('copy-card') as HTMLButtonElement | null;

copyCard?.addEventListener('click', async () => {
    const originalText = copyCard.dataset.originalText ?? copyCard.textContent ?? '';
    // Сохраняем оригинальный текст один раз
    if (!copyCard.dataset.originalText) {
        copyCard.dataset.originalText = originalText;
    }

    try {
        await navigator.clipboard.writeText('2202208167331108');
        copyCard.textContent = '✓ ' + t('common.copied');
        copyCard.classList.add('is-copied');

        setTimeout(() => {
            copyCard.textContent = copyCard.dataset.originalText ?? originalText;
            copyCard.classList.remove('is-copied');
        }, 1500);
    } catch {
        // Fallback — если clipboard API недоступен
        const range = document.createRange();
        range.selectNodeContents(copyCard);
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

async function startReviewMode(): Promise<void> {
    try {
        const res = await apiRequest<PlayersListResponse>('/api/players');
        const sorted = [...res.players].sort((a, b) =>
            a.name.localeCompare(b.name, 'ru')
        );

        if (sorted.length === 0) {
            alert(t('control.no_players'));
            return;
        }

        const first = sorted[0];
        if (!first) return;

        state.reviewMode = {
            active: true,
            queue: sorted.map((p) => ({ id: p.id, name: p.name })),
            index: 0,
        };

        window.history.pushState(
            {},
            '',
            `/?player=${encodeURIComponent(first.name)}`
        );
        await openPlayerScreen(first.id);
    } catch (err) {
        alert('Не удалось начать проход: ' +
            (err instanceof Error ? err.message : String(err)));
    }
}