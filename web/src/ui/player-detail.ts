import { apiRequest } from '../api';
import { state } from '../state';
import { buildPlayerCardElement } from '../card';
import type { PlayerResponse, PlayerWithStats, RatingInput } from '../types';
import {
  renderRatingEditor,
  renderRatingsList,
} from './ratings';

export async function openPlayerScreen(playerId: number): Promise<void> {
  showScreen('screen-player');
  await loadPlayerDetail(playerId);
}

function mergePlayerWithDraft(
  base: PlayerWithStats,
  draft: RatingInput
): PlayerWithStats {
  return {
    ...base,
    races: [draft.race],
    adaptiveness: draft.adaptiveness,
    greed: draft.greed,
    survival: draft.survival,
    turtle: draft.turtle,
    aggression: draft.aggression,
    variety: draft.variety,
  };
}

/**
 * Возвращает данные для начального состояния редактора:
 * - если у пользователя есть своя оценка — берём её,
 * - иначе — дефолт (раса T, все параметры 3).
 */
async function fetchInitialRating(playerId: number): Promise<RatingInput> {
  try {
    const res = await apiRequest<{ rating: any | null }>(
      `/api/players/${playerId}/my-rating`,
      { token: state.token }
    );
    const mine = res.rating;
    if (mine) {
      return {
        race: mine.race,
        adaptiveness: mine.adaptiveness,
        greed: mine.greed,
        survival: mine.survival,
        turtle: mine.turtle,
        aggression: mine.aggression,
        variety: mine.variety,
      };
    }
  } catch {
    /* 401 или другая ошибка — используем дефолт */
  }
  return {
    race: 'T',
    adaptiveness: 3,
    greed: 3,
    survival: 3,
    turtle: 3,
    aggression: 3,
    variety: 3,
  };
}

/**
 * Проверяет, есть ли у пользователя сохранённая оценка.
 */
async function hasMyRating(playerId: number): Promise<boolean> {
  if (!state.token) return false;
  try {
    const res = await apiRequest<{ rating: any | null }>(
      `/api/players/${playerId}/my-rating`,
      { token: state.token }
    );
    return Boolean(res.rating);
  } catch {
    return false;
  }
}

export async function loadPlayerDetail(playerId: number): Promise<void> {
  const pane = document.getElementById('player-card-pane');
  const editPane = document.getElementById('player-edit-pane');
  const actions = document.getElementById('player-actions');
  const ratingsContainer = document.getElementById('ratings-list-container');
  if (!pane || !editPane || !actions || !ratingsContainer) return;

  // ============================================================
  // Сразу показываем скелетоны во всех трёх секциях
  // ============================================================
  pane.innerHTML = '<div class="skeleton-card"></div>';
  editPane.classList.remove('is-open');
  actions.innerHTML = `
    <div class="skeleton skeleton-line"></div>
    <div class="skeleton skeleton-line" style="width: 180px;"></div>
  `;
  ratingsContainer.innerHTML = `
    <div class="skeleton skeleton-block"></div>
  `;

  try {
    const { player } = await apiRequest<PlayerResponse>(
      `/api/players/${playerId}`
    );

    // Карточка — сразу (быстрый fade-in)
    renderCard(pane, player);

    if (!state.token) {
      actions.innerHTML = '';
      const hint = document.createElement('p');
      hint.className = 'hint fade-in';
      hint.textContent = 'Войдите, чтобы оценивать игроков.';
      actions.appendChild(hint);
      await renderRatingsList(playerId);
      return;
    }

    const mine = await hasMyRating(playerId);

    // ============================================================
    // Кнопки действий — с fade-in
    // ============================================================
    const renderViewActions = (): void => {
      editPane.classList.remove('is-open');
      actions.innerHTML = '';

      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'btn-primary fade-in';
      editBtn.textContent = mine ? '✎ Изменить мою оценку' : '+ Добавить оценку';
      editBtn.addEventListener('click', () => {
        void enterEditMode();
      });
      actions.appendChild(editBtn);

      if (mine) {
        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'btn-danger fade-in';
        delBtn.textContent = '🗑 Удалить мою оценку';
        delBtn.addEventListener('click', () => {
          void (async () => {
            if (!confirm('Удалить вашу оценку?')) return;
            try {
              delBtn.disabled = true;
              delBtn.textContent = 'Удаление…';
              await apiRequest(`/api/players/${playerId}/my-rating`, {
                method: 'DELETE',
                token: state.token,
              });
              await loadPlayerDetail(playerId);
            } catch (err) {
              delBtn.disabled = false;
              delBtn.textContent = '🗑 Удалить мою оценку';
              alert(
                'Не удалось удалить: ' +
                  (err instanceof Error ? err.message : String(err))
              );
            }
          })();
        });
        actions.appendChild(delBtn);
      }
    };

    // ============================================================
    // Вход в режим редактирования — со скелетоном внутри панели
    // ============================================================
    const enterEditMode = async (): Promise<void> => {
      // Скелетон в редакторе, пока грузим свою оценку
      const formContainer = document.getElementById('rating-form-container');
      if (formContainer) {
        formContainer.innerHTML = `
          <div class="skeleton skeleton-block" style="height: 480px;"></div>
        `;
      }

      // Открываем панель сразу — скелетон уже виден
      editPane.classList.add('is-open');

      const initial = await fetchInitialRating(playerId);

      // Меняем кнопки на «Сохранить»/«Отмена»
      actions.innerHTML = '';

      const saveBtn = document.createElement('button');
      saveBtn.type = 'button';
      saveBtn.className = 'btn-primary fade-in';
      saveBtn.textContent = 'Сохранить';
      actions.appendChild(saveBtn);

      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'btn-secondary fade-in';
      cancelBtn.textContent = 'Отмена';
      cancelBtn.addEventListener('click', () => {
        renderCard(pane, player);
        void loadPlayerDetail(playerId);
      });
      actions.appendChild(cancelBtn);

      let currentDraft: RatingInput = initial;

      const onDraftChange = (draft: RatingInput): void => {
        currentDraft = draft;
        const preview = mergePlayerWithDraft(player, draft);
        renderCard(pane, preview);
      };

      // Заменяем скелетон реальным редактором
      renderRatingEditor(initial, onDraftChange);

      // Плавное появление формы
      if (formContainer) {
        formContainer.firstElementChild?.classList.add('fade-in');
      }

      saveBtn.addEventListener('click', () => {
        void (async () => {
          try {
            saveBtn.disabled = true;
            saveBtn.textContent = 'Сохранение…';
            await apiRequest(`/api/players/${playerId}/ratings`, {
              method: 'POST',
              token: state.token,
              body: currentDraft,
            });
            await loadPlayerDetail(playerId);
          } catch (err) {
            saveBtn.disabled = false;
            saveBtn.textContent = 'Сохранить';
            alert(
              'Не удалось сохранить: ' +
                (err instanceof Error ? err.message : String(err))
            );
          }
        })();
      });
    };

    renderViewActions();
    await renderRatingsList(playerId);
  } catch (err) {
    pane.innerHTML = `<p class="error fade-in">Ошибка: ${
      err instanceof Error ? err.message : String(err)
    }</p>`;
    actions.innerHTML = '';
    ratingsContainer.innerHTML = '';
  }
}

function renderCard(pane: HTMLElement, player: PlayerWithStats): void {
  const newCard = buildPlayerCardElement(player, { compact: false });
  const existing = pane.querySelector('.player-card');
  if (existing) existing.replaceWith(newCard);
  else {
    pane.innerHTML = '';
    pane.appendChild(newCard);
  }
}

export function showScreen(id: string): void {
  document.querySelectorAll('.screen').forEach((s) => s.classList.add('hidden'));
  document.getElementById(id)?.classList.remove('hidden');
}