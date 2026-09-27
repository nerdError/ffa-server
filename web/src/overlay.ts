import './styles/card.css';
import { apiRequest } from './api';
import { buildPlayerCardElement } from './card';
import type { PlayerResponse, PlayerWithStats } from './types';

// --- Читаем параметры из URL ---
// /overlay?player=Leonardo&refresh=30
// /overlay?id=42&refresh=30
const params = new URLSearchParams(window.location.search);
const playerName = params.get('player');
const playerId = params.get('id');
const refreshSec = Math.max(0, Number(params.get('refresh') ?? '0'));

const root = document.getElementById('root')!;

function showError(message: string): void {
  root.innerHTML = `<div class="overlay-error">${message}</div>`;
}

/**
 * Загружает игрока и обновляет карточку в DOM.
 * Возвращает true, если удалось, false — если нет.
 */
async function renderCard(): Promise<boolean> {
  try {
    let player: PlayerWithStats;

    if (playerId) {
      const res = await apiRequest<PlayerResponse>(`/api/players/${playerId}`);
      player = res.player;
    } else if (playerName) {
      // Ищем игрока по имени через список (у нас нет отдельного эндпоинта поиска)
      const list = await apiRequest<{ players: PlayerWithStats[] }>('/api/players');
      const found = list.players.find(
        (p) => p.name.toLowerCase() === playerName.toLowerCase()
      );
      if (!found) {
        showError(`Игрок "${playerName}" не найден`);
        return false;
      }
      player = found;
    } else {
      showError('Укажите ?player=Имя или ?id=42 в URL');
      return false;
    }

    const card = buildPlayerCardElement(player, { compact: true });

    // Плавная замена: если карточка уже есть — обновляем только её содержимое
    const existing = root.querySelector('.player-card');
    if (existing) {
      existing.replaceWith(card);
    } else {
      root.innerHTML = '';
      root.appendChild(card);
    }

    return true;
  } catch (err) {
    showError(
      'Ошибка загрузки: ' +
        (err instanceof Error ? err.message : String(err))
    );
    return false;
  }
}

// --- Первичная отрисовка ---
void renderCard();

// --- Периодическое обновление (если указано) ---
if (refreshSec > 0) {
  setInterval(() => {
    void renderCard();
  }, refreshSec * 1000);
}