import './styles/main.css';
import './styles/radar.css';
import './styles/card.css';

import { apiRequest, ApiRequestError } from './api';
import { state, clearSession } from './state';
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
function init(): void {
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

  if (state.token && state.user) {
    // Проверим токен запросом к защищённому эндпоинту
    // (или просто попробуем загрузить список и поймаем 401)
    apiRequest('/api/players')
      .then(() => {
        void openPlayersScreen();
      })
      .catch((err: unknown) => {
        if (err instanceof ApiRequestError && err.status === 401) {
          clearSession();
        }
        renderUserBox();
        showScreen('screen-auth');
      });
  } else {
    showScreen('screen-auth');
  }
}

init();