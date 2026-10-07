import {
    applyTranslations,
    getLocale,
    onLocaleChange,
    setLocale,
    t,
    type Locale,
} from './i18n';
import { clearSession, saveSession, state } from './state';
import { apiRequest } from './api';
import { navigateTo, updateTitle } from './router';

let rolesLoadingPromise: Promise<void> | null = null;

/**
 * Гарантирует, что роли пользователя загружены в state.user.
 * Если запрос уже идёт — ждёт его. Если роли уже есть — сразу возвращает.
 */
export async function ensureRolesLoaded(): Promise<void> {
  // Нет токена — нечего грузить
  if (!state.token || !state.user) return;

  // Если роли уже есть — не тратим запрос
  if (
    typeof state.user.is_moderator === 'boolean' &&
    typeof state.user.can_rate === 'boolean'
  ) return;

  // Если запрос уже идёт — ждём его
  if (rolesLoadingPromise) return rolesLoadingPromise;

  rolesLoadingPromise = (async () => {
    try {
      const me = await apiRequest<{
        user: {
          id: string;
          email: string;
          username: string | null;
          is_moderator: boolean;
          is_admin: boolean;
          is_ghost: boolean;
          can_rate: boolean;
        };
      }>('/api/auth/me', { token: state.token });

      saveSession(
        {
          id: me.user.id,
          email: me.user.email,
          username: me.user.username,
          is_moderator: me.user.is_moderator,
          is_admin: me.user.is_admin,
          is_ghost: me.user.is_ghost,
          can_rate: me.user.can_rate,
        },
        state.token!,
      );

      renderUserBox();
    } catch (err) {
      console.warn('[app] failed to load roles:', err);
    } finally {
      rolesLoadingPromise = null;
    }
  })();

  return rolesLoadingPromise;
}

/**
 * Инициализация общего UI: переключатель языка, renderUserBox, footer.
 * Вызывается один раз при старте приложения.
 */
export function setupApp(): void {
    setupLangSwitch();
    renderUserBox();
    setupFooterDiscordCopy();
    setupSupportButton();

    window.addEventListener('session:changed', () => {
        renderUserBox();
    });

    onLocaleChange(() => {
        applyTranslations();
        renderUserBox();
        updateTitle();
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
        } else if (state.user.is_ghost) {
            const badge = document.createElement('span');
            badge.className = 'role-badge role-badge--ghost';
            badge.textContent = `💠 ${t('topbar.role_ghost')}`;
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

        if (state.user.player_id) {
            const profileLink = document.createElement('a');
            profileLink.href = `/?player=${encodeURIComponent(state.user.player_name ?? '')}`;
            profileLink.className = 'topbar-link topbar-link--profile';
            profileLink.innerHTML = `👤 <span class="btn-label">${t('topbar.my_profile')}</span>`;
            box.appendChild(profileLink);
        }

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

/**
 * Кнопка поддержки: копирует номер карты и показывает toast.
 */
function setupSupportButton(): void {
  const btn = document.getElementById('btn-support');
  if (!btn) return;

  const CARD_NUMBER = '2202208167331108';

  // Готовим toast один раз
  let toast = document.getElementById('support-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'support-toast';
    toast.className = 'support-toast';
    document.body.appendChild(toast);
  }

  btn.addEventListener('click', () => {
    void (async () => {
      try {
        await navigator.clipboard.writeText(CARD_NUMBER);
        showSupportToast(toast!, true);
      } catch {
        // Fallback: показать номер и подсказать скопировать вручную
        showSupportToast(toast!, false);
      }
    })();
  });
}

function showSupportToast(toast: HTMLElement, copied: boolean): void {
  toast.innerHTML = `
    <span class="support-toast-title">${t('support.card_title')}</span>
    <span class="support-toast-card">2202 2081 6733 1108</span>
    <span class="support-toast-status">${
      copied
        ? '✓ ' + t('support.copied')
        : t('support.copy_manually_short')
    }</span>
  `;

  toast.classList.add('is-visible');

  // Скрываем через 3 секунды
  const timer = setTimeout(() => {
    toast.classList.remove('is-visible');
  }, 3000);

  // Если кликнули снова до скрытия — сбрасываем таймер
  toast.dataset.timer = String(timer);
}