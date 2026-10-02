import { apiRequest } from '../api';
import { state } from '../state';
import { buildPlayerCardElement } from '../card';
import type { PlayerResponse, PlayerWithStats, Race, RatingInput } from '../types';
import {
    renderRatingEditor,
    renderRatingsList,
} from './ratings';
import { renderUserBox } from '../main';
import { applyTranslations, onLocaleChange, t } from '../i18n';

onLocaleChange((locale) => {
    applyTranslations();
    // if (lastPlayerId) loadPlayerDetail(lastPlayerId);
    if (lastPane && lastPlayer) renderCard(lastPane, lastPlayer)
});

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
async function fetchInitialRating(
  playerId: number,
  dominantRace: Race | null
): Promise<RatingInput> {
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
    /* 401 — используем дефолт */
  }

  // Нет своей оценки — выбираем доминирующую расу игрока
  return {
    race: dominantRace ?? 'T',
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
            {
                token: state.token,
            }
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
            hint.dataset.i18n = "player.login_to_rate";
            hint.innerHTML = `${t('player.login_to_rate')} `;

            const loginLink = document.createElement('a');
            loginLink.href = '#';
            loginLink.dataset.i18n = "auth.login_link";
            loginLink.textContent = t("auth.login_link")
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
            editBtn.dataset.i18n = mine ? 'player.rating_edit' : 'player.rating_add';
            editBtn.textContent = mine ? `✎ ${t('player.rating_edit')}` : `+ ${t('player.rating_add')}`;
            editBtn.addEventListener('click', () => void enterEditMode());
            actions.appendChild(editBtn);

            if (mine) {
                const delBtn = document.createElement('button');
                delBtn.type = 'button';
                delBtn.className = 'btn-danger fade-in';
                editBtn.dataset.i18n = "player.rating_delete"
                delBtn.textContent = `🗑 ${t("player.rating_delete")}`;
                delBtn.addEventListener('click', () => {
                    void (async () => {
                        if (!confirm(t('player.rating_delete_confirm'))) return;
                        try {
                            delBtn.disabled = true;
                            delBtn.textContent = t("common.deleting");
                            await apiRequest(`/api/players/${playerId}/my-rating`, {
                                method: 'DELETE',
                                token: state.token,
                            });
                            await loadPlayerDetail(playerId);
                        } catch (err) {
                            delBtn.disabled = false;
                            delBtn.textContent = `🗑 ${t("player.rating_delete")}`;
                            alert(
                                `${t("player.rating_delete_error")}: ` +
                                (err instanceof Error ? err.message : String(err))
                            );
                        }
                    })();
                });
                actions.appendChild(delBtn);
            }

            // Кнопка переименования — только для модераторов/админов
            const canRename = Boolean(state.user?.is_moderator || state.user?.is_admin);
            if (canRename) {
                const renameBtn = document.createElement('button');
                renameBtn.type = 'button';
                renameBtn.className = 'btn-secondary fade-in';
                renameBtn.dataset.i18n = "player.name_edit";
                renameBtn.textContent = `✎ ${t('player.name_edit')}`;
                renameBtn.title = 'Переименовать игрока';
                renameBtn.addEventListener('click', () => {
                    void (async () => {
                        const next = prompt(
                            `Новое имя для "${player.name}":`,
                            player.name
                        );
                        if (next === null) return;

                        const trimmed = next.trim();
                        if (!trimmed) {
                            alert('Имя не может быть пустым');
                            return;
                        }
                        if (trimmed === player.name) return;

                        try {
                            await apiRequest(`/api/players/${player.id}/name`, {
                                method: 'PATCH',
                                token: state.token,
                                body: { name: trimmed },
                            });
                            await loadPlayerDetail(playerId);
                        } catch (err) {
                            alert('Не удалось переименовать: ' +
                                (err instanceof Error ? err.message : String(err)));
                        }
                    })();
                });
                actions.appendChild(renameBtn);
            }

            // Кнопка редактирования aka — только для модераторов/админов
            const canEditAka = Boolean(state.user?.is_moderator || state.user?.is_admin);
            if (canEditAka) {
                const akaBtn = document.createElement('button');
                akaBtn.type = 'button';
                akaBtn.className = 'btn-secondary fade-in';
                akaBtn.textContent = '✎ Aka';
                akaBtn.title = 'Изменить альтернативные имена';
                akaBtn.addEventListener('click', () => {
                    void (async () => {
                        const current = player.aka ?? '';
                        const next = prompt(
                            `Альтернативные имена для "${player.name}" (через запятую):`,
                            current
                        );
                        if (next === null) return; // отмена

                        const trimmed = next.trim();

                        try {
                            await apiRequest(`/api/players/${player.id}/aka`, {
                                method: 'PATCH',
                                token: state.token,
                                body: { aka: trimmed || null },
                            });
                            // Перезагружаем карточку
                            await loadPlayerDetail(playerId);
                        } catch (err) {
                            alert('Не удалось сохранить: ' +
                                (err instanceof Error ? err.message : String(err)));
                        }
                    })();
                });
                actions.appendChild(akaBtn);
            }

            // Кнопка «Следующий» — только в режиме прохода
            if (state.reviewMode?.active) {
                const nextBtn = document.createElement('button');
                nextBtn.type = 'button';
                nextBtn.className = 'btn-primary fade-in';
                nextBtn.dataset.i18n = "player.next_player";
                nextBtn.textContent = `${t('player.next_player')} →`;

                const { queue, index } = state.reviewMode;
                const isLast = index >= queue.length - 1;

                if (isLast) {
                    // На последнем игроке — кнопка «Завершить»
                    nextBtn.dataset.i18n = "common.finish";
                    nextBtn.textContent = `✓ ${t('common.finish')}`;
                    nextBtn.addEventListener('click', () => {
                        state.reviewMode = null;
                        window.history.pushState({}, '', '/');
                        if (state.onBackToList) {
                            state.onBackToList();
                        }
                    });
                } else {
                    nextBtn.addEventListener('click', () => {
                        void goToNextPlayer();
                    });
                }

                actions.appendChild(nextBtn);
            }
        };

        /** Кнопки «Сохранить»/«Отмена» для режима редактирования */
        const renderEditActions = (onSave: () => void, onCancel: () => void): void => {
            actions.innerHTML = '';

            const saveBtn = document.createElement('button');
            saveBtn.type = 'button';
            saveBtn.className = 'btn-primary fade-in';
            saveBtn.dataset.i18n = "player.edit_save";
            saveBtn.textContent = t('player.edit_save');
            saveBtn.addEventListener('click', onSave);
            actions.appendChild(saveBtn);

            const cancelBtn = document.createElement('button');
            cancelBtn.type = 'button';
            cancelBtn.dataset.i18n = "player.edit_cancel";
            cancelBtn.className = 'btn-secondary fade-in';
            cancelBtn.textContent = t('player.edit_cancel');
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
            const initial = await fetchInitialRating(playerId, player.dominant_race ?? null);

            let currentDraft: RatingInput = initial;

            const handleSave = (): void => {
                void (async () => {
                    const saveBtn = actions.querySelector('.btn-primary') as HTMLButtonElement | null;
                    if (saveBtn) {
                        saveBtn.disabled = true;
                        saveBtn.textContent = t('player.rating_saving');
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
                            saveBtn.dataset.i18n = "player.edit_save";
                            saveBtn.textContent = t('player.edit_save');
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
        pane.innerHTML = `<p class="error fade-in">${t('common.error')}: ${err instanceof Error ? err.message : String(err)
            }</p>`;
        actions.innerHTML = '';
        ratingsContainer.innerHTML = '';
    }
}

let lastPane: HTMLElement | null = null;
let lastPlayer: PlayerWithStats | null = null;

function renderCard(pane: HTMLElement, player: PlayerWithStats): void {
    lastPane = pane;
    lastPlayer = player;

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
    window.dispatchEvent(new Event('session:changed'));
}

export function navigateTo(id: string): void {
    showScreen(id);
    renderUserBox();
}

async function goToNextPlayer(): Promise<void> {
  if (!state.reviewMode?.active) return;

  const { queue, index } = state.reviewMode;
  const nextIndex = index + 1;

  if (nextIndex >= queue.length) {
    state.reviewMode = null;
    if (state.onBackToList) state.onBackToList();
    return;
  }

  const next = queue[nextIndex];
  if (!next) return;   // на всякий случай

  state.reviewMode.index = nextIndex;

  window.history.pushState(
    {},
    '',
    `/?player=${encodeURIComponent(next.name)}`
  );
  await openPlayerScreen(next.id);
}