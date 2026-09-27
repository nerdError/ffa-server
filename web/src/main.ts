import './styles/main.css';
import './styles/radar.css';
import './styles/card.css';

import { apiRequest, ApiRequestError } from './api';
import { state, clearSession, saveSession } from './state';
import { bindAuth } from './ui/auth';
import { bindCreatePlayer, loadPlayers } from './ui/players';
import { openPlayerScreen, showScreen } from './ui/player-detail';

// --- User box в шапке ---
function renderUserBox(): void {
  const box = document.getElementById('user-box');
  if (!box) return;
  box.innerHTML = '';

  if (state.user) {
    const span = document.createElement('span');
    span.textContent = state.user.email;

    const btn = document.createElement('button');
    btn.textContent = 'Выйти';
    btn.className = 'btn-secondary';
    btn.addEventListener('click', () => {
      void (async () => {
        try {
          await apiRequest('/api/auth/logout', {
            method: 'POST',
            token: state.token,
          });
        } catch {
          /* игнорируем — токен всё равно протухнет */
        }
        clearSession();
        renderUserBox();
        showScreen('screen-auth');
      })();
    });

    box.append(span, btn);
  } else {
    const span = document.createElement('span');
    span.textContent = 'Вы не авторизованы';
    box.appendChild(span);
  }
}

// --- Навигация ---
async function openPlayersScreen(): Promise<void> {
  showScreen('screen-players');
  await loadPlayers({ onOpenPlayer: (id) => void openPlayerScreen(id) });
}

// --- Инициализация ---
async function init(): Promise<void> {
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
    void openPlayersScreen();
  });

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

  if (!state.token || !state.user) {
    await waitMinLoader();
    showScreen('screen-auth');
    return;
  }

  try {
    // Валидируем токен и заодно обновляем user (username, is_moderator)
    const me = await apiRequest<{
      user: { id: string; email: string; username: string | null; is_moderator: boolean };
    }>('/api/auth/me', { token: state.token });

    // Обновляем user в state (сохранится в localStorage через saveSession)
    saveSession(
      { id: me.user.id, email: me.user.email },
      state.token
    );
    renderUserBox();

    await waitMinLoader();
    void openPlayersScreen();
  } catch (err) {
    await waitMinLoader();
    if (err instanceof ApiRequestError && err.status === 401) {
      clearSession();
    }
    renderUserBox();
    showScreen('screen-auth');
  }
}

init();