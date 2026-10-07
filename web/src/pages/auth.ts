import { bindAuth } from '../ui/auth';
import { renderUserBox } from '../app';
import { navigateTo } from '../router';

let cleanupAuth: (() => void) | null = null;

export function mountAuth(_params: URLSearchParams): void {
  const screen = document.getElementById('screen-auth');
  if (screen) screen.classList.remove('hidden');

  cleanupAuth = bindAuth({
    renderUserBox,
    onLoginSuccess: () => {
      // Проверяем, был ли redirect (например, с /control или /admin)
      const redirect = sessionStorage.getItem('redirectAfterLogin');
      if (redirect) {
        sessionStorage.removeItem('redirectAfterLogin');
        navigateTo(redirect, true);
        return;
      }
      // Иначе — на главную (список игроков)
      navigateTo('/', true);
    },
  });
}

export function unmountAuth(): void {
  // Снимаем обработчики, чтобы при повторном заходе на /auth не копились
  // дублирующиеся слушатели (иначе один сабмит шлёт несколько запросов).
  cleanupAuth?.();
  cleanupAuth = null;
}