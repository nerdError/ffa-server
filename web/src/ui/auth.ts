import { apiRequest } from '../api';
import { saveSession } from '../state';
import { t } from '../i18n';
import type { LoginResponse, SignupResponse } from '../types';

interface AuthCallbacks {
    onLoginSuccess: () => void;
    renderUserBox: () => void;
}

/**
 * Догружает роли, username, привязанного игрока через /api/auth/me
 * и сохраняет всё в session. Возвращает обновлённого user или null.
 */
async function fetchAndSaveFullUser(
    accessToken: string,
    refreshToken?: string
): Promise<{ id: string; email: string } | null> {
    try {
        const me = await apiRequest<{
            user: {
                id: string;
                email: string;
                username: string | null;
                is_moderator: boolean;
                is_admin: boolean;
                is_ghost: boolean;
                player_id: number | null;
                player_name: string | null;
            };
        }>('/api/auth/me', { token: accessToken });

        saveSession(
            {
                id: me.user.id,
                email: me.user.email,
                username: me.user.username,
                is_moderator: me.user.is_moderator,
                is_admin: me.user.is_admin,
                is_ghost: me.user.is_ghost,
                player_id: me.user.player_id,
                player_name: me.user.player_name,
            },
            accessToken,
            refreshToken
        );

        return { id: me.user.id, email: me.user.email };
    } catch (err) {
        console.warn('[auth] failed to fetch /me after login:', err);
        return null;
    }
}

export function bindAuth(cb: AuthCallbacks): void {
    const formLogin = document.getElementById('form-login') as HTMLFormElement | null;
    const formSignup = document.getElementById('form-signup') as HTMLFormElement | null;
    const cardSignup = document.getElementById('card-signup');
    const screenAuth = document.getElementById('screen-auth');
    if (!formLogin || !formSignup || !cardSignup || !screenAuth) return;

    const loginCard = screenAuth.querySelector('.card');
    if (!loginCard) return;

    // Ссылки переключения форм
    document.getElementById('link-to-signup')?.addEventListener('click', (e) => {
        e.preventDefault();
        loginCard.classList.add('hidden');
        cardSignup.classList.remove('hidden');
    });

    document.getElementById('link-to-login')?.addEventListener('click', (e) => {
        e.preventDefault();
        cardSignup.classList.add('hidden');
        loginCard.classList.remove('hidden');
    });

    // ============================================================
    // Логин
    // ============================================================
    formLogin.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(formLogin);
        const identifier = String(fd.get('identifier') ?? '').trim();
        const password = String(fd.get('password') ?? '');

        if (!identifier) {
            alert(t('auth.error_identifier_required'));
            return;
        }
        if (!password) {
            alert(t('auth.error_password_required'));
            return;
        }

        try {
            const res = await apiRequest<LoginResponse>('/api/auth/login', {
                method: 'POST',
                body: { identifier, password },
            });

            // Сохраняем базовые данные с токенами
            saveSession(res.user, res.access_token, res.refresh_token);

            // Догружаем роли, username, player_id
            await fetchAndSaveFullUser(res.access_token, res.refresh_token);

            // Только после этого обновляем UI и переходим
            cb.renderUserBox();
            cb.onLoginSuccess();
        } catch (err) {
            alert(t('auth.error_login') + (err instanceof Error ? err.message : String(err)));
        }
    });

    // ============================================================
    // Регистрация
    // ============================================================
    formSignup.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(formSignup);

        const username = String(fd.get('username') ?? '').trim();
        const email = String(fd.get('email') ?? '').trim();
        const password = String(fd.get('password') ?? '');

        // Клиентская валидация
        if (username.length < 3) {
            alert(t('auth.error_username_short'));
            return;
        }
        if (!email.includes('@')) {
            alert(t('auth.error_email_invalid'));
            return;
        }
        if (password.length < 6) {
            alert(t('auth.error_password_short'));
            return;
        }

        try {
            const res = await apiRequest<SignupResponse>('/api/auth/signup', {
                method: 'POST',
                body: { username, email, password },
            });

            if (res.session && res.user) {
                // Confirm email выключен — сразу логиним
                saveSession(res.user, res.session.access_token, res.session.refresh_token);

                await fetchAndSaveFullUser(res.session.access_token, res.session.refresh_token);

                cb.renderUserBox();
                cb.onLoginSuccess();
            } else {
                // Confirm email включён
                alert(t('auth.account_created_confirm'));
                cardSignup.classList.add('hidden');
                loginCard.classList.remove('hidden');
            }
        } catch (err) {
            alert(t('auth.error_signup') + (err instanceof Error ? err.message : String(err)));
        }
    });
}