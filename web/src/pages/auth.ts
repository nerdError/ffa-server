import { bindAuth } from '../ui/auth';
import { renderUserBox } from '../app';
import { navigateTo } from '../router';

export function mountAuth(_params: URLSearchParams): void {
  const screen = document.getElementById('screen-auth');
  if (screen) screen.classList.remove('hidden');

  bindAuth({
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
  // Обработчики снимаются автоматически, потому что bindAuth использует
  // addEventListener без долгоживущих эффектов. При следующем монтировании
  // auth.ts всё равно перезагружается и заново вешает обработчики.
}