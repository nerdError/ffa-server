import { apiRequest } from '../api';
import { state } from '../state';
import { buildPlayerCardElement } from '../card';
import type { PlayerResponse, PlayerWithStats, RatingInput } from '../types';
import { renderRatingForm, renderRatingsList } from './ratings';

export async function openPlayerScreen(playerId: number): Promise<void> {
  showScreen('screen-player');
  await loadPlayerDetail(playerId);
}

/**
 * Строит "гипотетического" игрока: базовые данные + черновик оценки.
 * Используется для live-превью при движении слайдеров.
 */
function mergePlayerWithDraft(
  base: PlayerWithStats,
  draft: RatingInput
): PlayerWithStats {
  return {
    ...base,
    // Раса: если пользователь выбрал — показываем её как «одну из»
    races: base.races.length > 0 ? base.races : [draft.race],
    // Средние из черновика (это preview, а не реальные данные)
    adaptiveness: draft.adaptiveness,
    greed: draft.greed,
    survival: draft.survival,
    turtle: draft.turtle,
    aggression: draft.aggression,
    variety: draft.variety,
  };
}

export async function loadPlayerDetail(playerId: number): Promise<void> {
  const pane = document.getElementById('player-card-pane');
  const ratingsContainer = document.getElementById('ratings-list-container');
  const formContainer = document.getElementById('rating-form-container');
  if (!pane || !ratingsContainer || !formContainer) return;

  pane.innerHTML = '<div class="skeleton-card"></div>';
  ratingsContainer.innerHTML = '';
  formContainer.innerHTML = '';

  try {
    const { player } = await apiRequest<PlayerResponse>(
      `/api/players/${playerId}`
    );

    // Первичный рендер реальных данных
    pane.innerHTML = '';
    pane.appendChild(buildPlayerCardElement(player, { compact: false }));

    // Форма с live-превью
    if (state.token) {
      await renderRatingForm(
        playerId,
        (draft) => {
          // На каждое движение слайдера — пересобираем карточку
          const preview = mergePlayerWithDraft(player, draft);
          const newCard = buildPlayerCardElement(preview, { compact: false });
          const existing = pane.querySelector('.player-card');
          if (existing) existing.replaceWith(newCard);
          else {
            pane.innerHTML = '';
            pane.appendChild(newCard);
          }
        },
        () => {
          void loadPlayerDetail(playerId);
        }
      );
    } else {
      // Не залогинен — просто показываем данные
    }

    await renderRatingsList(playerId);
  } catch (err) {
    pane.innerHTML = `<p class="error">Ошибка: ${
      err instanceof Error ? err.message : String(err)
    }</p>`;
  }
}

export function showScreen(id: string): void {
  document.querySelectorAll('.screen').forEach((s) => s.classList.add('hidden'));
  document.getElementById(id)?.classList.remove('hidden');
}