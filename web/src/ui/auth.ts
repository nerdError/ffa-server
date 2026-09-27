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
    try {
      const res = await apiRequest<LoginResponse>('/api/auth/login', {
        method: 'POST',
        body: {
          email: String(fd.get('email') ?? ''),
          password: String(fd.get('password') ?? ''),
        },
      });
      saveSession(res.user, res.access_token);
      cb.renderUserBox();
      cb.onLoginSuccess();
    } catch (err) {
      alert('Ошибка входа: ' + (err instanceof Error ? err.message : String(err)));
    }
  });

  formSignup.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(formSignup);
    try {
      const res = await apiRequest<SignupResponse>('/api/auth/signup', {
        method: 'POST',
        body: {
          email: String(fd.get('email') ?? ''),
          password: String(fd.get('password') ?? ''),
        },
      });
      if (res.session && res.user) {
        saveSession(res.user, res.session.access_token);
        cb.renderUserBox();
        cb.onLoginSuccess();
      } else {
        alert('Аккаунт создан. Проверьте почту для подтверждения.');
        cardSignup.classList.add('hidden');
        loginCard.classList.remove('hidden');
      }
    } catch (err) {
      alert('Ошибка регистрации: ' + (err instanceof Error ? err.message : String(err)));
    }
  });
}