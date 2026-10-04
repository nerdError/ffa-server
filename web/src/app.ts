import {
    applyTranslations,
    getLocale,
    onLocaleChange,
    setLocale,
    t,
    type Locale,
} from './i18n';
import { clearSession, state } from './state';
import { apiRequest } from './api';
import { navigateTo, updateTitle } from './router';

/**
 * Инициализация общего UI: переключатель языка, renderUserBox, footer.
 * Вызывается один раз при старте приложения.
 */
export function setupApp(): void {
    setupLangSwitch();
    renderUserBox();
    setupFooterDiscordCopy();

    onLocaleChange(() => {
        applyTranslations();
        renderUserBox();
        updateTitle();
    });

    window.addEventListener('session:changed', () => {
        renderUserBox();
    });
}

/**
 * Рендерит шапку (user-box).
 */
export function renderUserBox(): void {
    const box = document.getElementById('user-box');
    if (!box) return;
    box.innerHTML = '';

    if (state.user) {
        // Ссылка на /control
        const controlLink = document.createElement('a');
        controlLink.href = '/control';
        controlLink.className = 'topbar-link';
        controlLink.innerHTML = `🎬 <span class="btn-label">${t('topbar.streamer_mode')}</span>`;

        // Бейдж + ник
        const nameWrap = document.createElement('span');
        nameWrap.className = 'topbar-username';
        nameWrap.textContent = state.user.username || state.user.email;

        if (state.user.is_admin) {
            const badge = document.createElement('span');
            badge.className = 'role-badge role-badge--admin';
            badge.textContent = `★ ${t('topbar.role_admin')}`;
            nameWrap.appendChild(badge);
        } else if (state.user.is_moderator) {
            const badge = document.createElement('span');
            badge.className = 'role-badge role-badge--moderator';
            badge.textContent = `◆ ${t('topbar.role_moderator')}`;
            nameWrap.appendChild(badge);
        }

        // Кнопка админа
        let adminLink: HTMLAnchorElement | null = null;
        if (state.user.is_admin) {
            adminLink = document.createElement('a');
            adminLink.href = '/admin';
            adminLink.className = 'topbar-link topbar-link--admin';
            adminLink.innerHTML = `⚙ <span class="btn-label">${t('topbar.admin')}</span>`;
        }

        // Выйти
        const logoutBtn = document.createElement('button');
        logoutBtn.textContent = t('common.logout');
        logoutBtn.className = 'btn-secondary';
        logoutBtn.addEventListener('click', () => {
            void (async () => {
                try {
                    await apiRequest('/api/auth/logout', {
                        method: 'POST',
                        token: state.token,
                    });
                } catch { }
                clearSession();
                renderUserBox();
                navigateTo('/', true);
            })();
        });

        box.append(controlLink);
        if (adminLink) box.append(adminLink);
        box.append(nameWrap, logoutBtn);
        return;
    }

    // Не залогинен — кнопка «Войти»
    const loginBtn = document.createElement('button');
    loginBtn.type = 'button';
    loginBtn.className = 'topbar-login-btn';
    loginBtn.textContent = t('common.login');
    loginBtn.addEventListener('click', () => {
        navigateTo('/auth');
    });
    box.appendChild(loginBtn);
}

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
            if (lang === 'ru' || lang === 'en') setLocale(lang);
        });
    });

    updateActive(getLocale());
    onLocaleChange(updateActive);
}

function setupFooterDiscordCopy(): void {
    const btn = document.getElementById('copy-discord');
    if (!btn) return;

    btn.addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText('nerderror');
            const original = btn.textContent;
            btn.textContent = '✓ Скопировано';
            setTimeout(() => {
                btn.textContent = original;
            }, 1500);
        } catch { }
    });
}