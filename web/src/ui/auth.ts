import { apiRequest } from '../api';
import { saveSession } from '../state';
import type { LoginResponse, SignupResponse } from '../types';

interface AuthCallbacks {
    onLoginSuccess: () => void;
    renderUserBox: () => void;
}

export function bindAuth(cb: AuthCallbacks): void {
    const formLogin = document.getElementById('form-login') as HTMLFormElement | null;
    const formSignup = document.getElementById('form-signup') as HTMLFormElement | null;
    const cardSignup = document.getElementById('card-signup');
    const screenAuth = document.getElementById('screen-auth');
    if (!formLogin || !formSignup || !cardSignup || !screenAuth) return;

    const loginCard = screenAuth.querySelector('.card');
    if (!loginCard) return;

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

    formLogin.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(formLogin);
        const identifier = String(fd.get('identifier') ?? '').trim();
        const password = String(fd.get('password') ?? '');

        if (!identifier) {
            alert('Введите email или никнейм');
            return;
        }
        if (!password) {
            alert('Введите пароль');
            return;
        }

        try {
            const res = await apiRequest<LoginResponse>('/api/auth/login', {
                method: 'POST',
                body: { identifier, password },
            });

            saveSession(res.user, res.access_token, res.refresh_token);

            try {
                console.log("apiRequest('/api/auth/me')");

                const me = await apiRequest<{
                    user: {
                        id: string;
                        email: string;
                        username: string | null;
                        is_moderator: boolean;
                        is_admin: boolean;
                    };
                }>('/api/auth/me', { token: res.access_token });

                saveSession(
                    {
                        id: me.user.id,
                        email: me.user.email,
                        username: me.user.username,
                        is_moderator: me.user.is_moderator,
                        is_admin: me.user.is_admin,
                    },
                    res.access_token,
                    res.refresh_token
                );
            } catch { }

            cb.renderUserBox();
            cb.onLoginSuccess();
        } catch (err) {
            alert('Ошибка входа: ' + (err instanceof Error ? err.message : String(err)));
        }
    });

    formSignup.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(formSignup);

        const username = String(fd.get('username') ?? '').trim();
        const email = String(fd.get('email') ?? '').trim();
        const password = String(fd.get('password') ?? '');

        // Простая клиентская валидация, чтобы не гонять заведомо неверное
        if (username.length < 3) {
            alert('Никнейм должен быть не короче 3 символов');
            return;
        }
        if (!email.includes('@')) {
            alert('Введите корректный email');
            return;
        }
        if (password.length < 6) {
            alert('Пароль должен быть не короче 6 символов');
            return;
        }

        try {
            const res = await apiRequest<SignupResponse>('/api/auth/signup', {
                method: 'POST',
                body: { username, email, password },
            });

            if (res.session && res.user) {
                // Confirm email выключен — сразу логиним
                saveSession(res.user, res.session.access_token);
                cb.renderUserBox();
                cb.onLoginSuccess();
            } else {
                // Confirm email включён — сообщаем и переключаем на логин
                alert(
                    'Аккаунт создан. Проверьте почту, чтобы подтвердить email, затем войдите.'
                );
                cardSignup.classList.add('hidden');
                loginCard.classList.remove('hidden');
            }
        } catch (err) {
            alert('Ошибка регистрации: ' + (err instanceof Error ? err.message : String(err)));
        }
    });
}