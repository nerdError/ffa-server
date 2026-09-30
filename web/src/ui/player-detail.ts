import { apiRequest } from '../api';
import { state } from '../state';
import { buildPlayerCardElement } from '../card';
import type { PlayerResponse, PlayerWithStats, RatingInput } from '../types';
import {
    renderRatingEditor,
    renderRatingsList,
} from './ratings';
import { renderUserBox } from '../main';

// Обёртка: открывает карточку и меняет URL на имя игрока
async function openPlayerByName(player: { id: number; name: string }): Promise<void> {
  // Обновляем URL (без перезагрузки страницы)
  window.history.pushState({}, '', `/?player=${encodeURIComponent(player.name)}`);
  await openPlayerScreen(player.id);
}

export async function openPlayerScreen(playerId: number): Promise<void> {
    navigateTo('screen-player');
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
  // Скелетоны — сразу, пока грузим данные
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

    // Карточка
    renderCard(pane, player);

    // Залогинен ли пользователь
    const isAuthed = Boolean(state.token && state.user);
    const mine = isAuthed ? await hasMyRating(playerId) : false;

    // ============================================================
    // Вспомогательные рендеры кнопок
    // ============================================================

    /** Подсказка «Войдите, чтобы оценивать игроков» */
    const renderLoginHint = (): void => {
      actions.innerHTML = '';

      const hint = document.createElement('p');
      hint.className = 'hint fade-in';
      hint.innerHTML = 'Войдите, чтобы оценивать игроков. ';

      const loginLink = document.createElement('a');
      loginLink.href = '#';
      loginLink.textContent = 'Войти';
      loginLink.className = 'hint-link';
      loginLink.addEventListener('click', (e) => {
        e.preventDefault();
        document.querySelectorAll('.screen').forEach((s) => s.classList.add('hidden'));
        document.getElementById('screen-auth')?.classList.remove('hidden');
      });

      hint.appendChild(loginLink);
      actions.appendChild(hint);
    };

    /** Кнопки «Изменить»/«Добавить» + «Удалить» */
    const renderViewActions = (): void => {
      editPane.classList.remove('is-open');
      actions.innerHTML = '';

      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'btn-primary fade-in';
      editBtn.textContent = mine ? '✎ Изменить мою оценку' : '+ Добавить оценку';
      editBtn.addEventListener('click', () => void enterEditMode());
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

    /** Кнопки «Сохранить»/«Отмена» для режима редактирования */
    const renderEditActions = (onSave: () => void, onCancel: () => void): void => {
      actions.innerHTML = '';

      const saveBtn = document.createElement('button');
      saveBtn.type = 'button';
      saveBtn.className = 'btn-primary fade-in';
      saveBtn.textContent = 'Сохранить';
      saveBtn.addEventListener('click', onSave);
      actions.appendChild(saveBtn);

      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'btn-secondary fade-in';
      cancelBtn.textContent = 'Отмена';
      cancelBtn.addEventListener('click', onCancel);
      actions.appendChild(cancelBtn);
    };

    /** Верхнеуровневый выбор: показать подсказку или кнопки */
    const renderActions = (): void => {
      if (!isAuthed) {
        renderLoginHint();
      } else {
        renderViewActions();
      }
    };

    // ============================================================
    // Вход в режим редактирования
    // ============================================================
    const enterEditMode = async (): Promise<void> => {
      const formContainer = document.getElementById('rating-form-container');

      // Скелетон в редакторе
      if (formContainer) {
        formContainer.innerHTML = `
          <div class="skeleton skeleton-block" style="height: 480px;"></div>
        `;
      }

      // Открываем панель сразу
      editPane.classList.add('is-open');

      // Загружаем начальные данные
      const initial = await fetchInitialRating(playerId);

      let currentDraft: RatingInput = initial;

      const handleSave = (): void => {
        void (async () => {
          const saveBtn = actions.querySelector('.btn-primary') as HTMLButtonElement | null;
          if (saveBtn) {
            saveBtn.disabled = true;
            saveBtn.textContent = 'Сохранение…';
          }
          try {
            await apiRequest(`/api/players/${playerId}/ratings`, {
              method: 'POST',
              token: state.token,
              body: currentDraft,
            });
            await loadPlayerDetail(playerId);
          } catch (err) {
            if (saveBtn) {
              saveBtn.disabled = false;
              saveBtn.textContent = 'Сохранить';
            }
            alert(
              'Не удалось сохранить: ' +
                (err instanceof Error ? err.message : String(err))
            );
          }
        })();
      };

      const handleCancel = (): void => {
        renderCard(pane, player);
        void loadPlayerDetail(playerId);
      };

      // Ставим кнопки «Сохранить»/«Отмена»
      renderEditActions(handleSave, handleCancel);

      // Рендерим сам редактор
      renderRatingEditor(initial, (draft) => {
        currentDraft = draft;
        const preview = mergePlayerWithDraft(player, draft);
        renderCard(pane, preview);
      });

      // Плавное появление формы
      if (formContainer) {
        formContainer.firstElementChild?.classList.add('fade-in');
      }
    };

    // ============================================================
    // Первичный рендер
    // ============================================================
    renderActions();
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

export function navigateTo(id: string): void {
    showScreen(id);
    renderUserBox();
}