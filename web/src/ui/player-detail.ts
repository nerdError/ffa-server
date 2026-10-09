import { apiRequest } from '../api';
import { state } from '../state';
import { buildPlayerCardElement } from '../card';
import type { PlayerResponse, PlayerWithStats, Race, RatingInput, MyRating } from '../types';
import terranIconUrl from '../../assets/race/terran.svg';
import zergIconUrl from '../../assets/race/zerg.svg';
import protossIconUrl from '../../assets/race/protoss.svg';
import randomIconUrl from '../../assets/race/random.svg';
import {
    renderGivenRatingsList,
    renderRatingEditor,
    renderRatingsList,
} from './ratings';
import { applyTranslations, getLocale, onLocaleChange, t } from '../i18n';
import type { TranslationKey } from '../i18n/types';

type CardViewMode = 'average' | 'personal' | 'ghost';

const CARD_MODE_STORAGE = 'playerCardMode';

function readCardViewMode(): CardViewMode {
    const raw = localStorage.getItem(CARD_MODE_STORAGE);
    return raw === 'personal' || raw === 'ghost' ? raw : 'average';
}

onLocaleChange(() => {
    applyTranslations();
    if (lastPane && lastPlayer) renderCard(lastPane, lastPlayer);
    buildCardModeToggle();
});

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
    const givenRatingsContainer = document.getElementById('given-ratings-container');
    const hostContainer = document.getElementById('player-host-container');

    if (!pane || !editPane || !actions || !ratingsContainer || !givenRatingsContainer) return;

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
    givenRatingsContainer.innerHTML = '';
    if (hostContainer) hostContainer.innerHTML = '';

    try {
        const { player } = await apiRequest<PlayerResponse>(
            `/api/players/${playerId}`
        );

        // Данные для переключателя оценок над карточкой
        lastPlayerId = playerId;
        lastBasePlayer = player;
        buildCardModeToggle();

        // Карточка в выбранном режиме (средняя / моя / по GHOSTу)
        await renderCardForMode(pane, playerId, cardViewMode);

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
            editBtn.textContent = mine ? `${t('player.rating_edit')}` : `${t('player.rating_add')}`;

            editBtn.addEventListener('click', () => void enterEditMode());
            actions.appendChild(editBtn);

            if (mine) {
                const delBtn = document.createElement('button');
                delBtn.type = 'button';
                delBtn.className = 'btn-danger fade-in';

                delBtn.dataset.i18n = "player.rating_delete"
                delBtn.textContent = `${t("player.rating_delete")}`;

                delBtn.addEventListener('click', () => {
                    void (async () => {
                        if (!confirm(t('player.rating_delete_confirm'))) return;
                        try {
                            delBtn.disabled = true;

                            delBtn.dataset.i18n = "common.deleting";
                            delBtn.textContent = t("common.deleting");

                            await apiRequest(`/api/players/${playerId}/my-rating`, {
                                method: 'DELETE',
                                token: state.token,
                            });
                            await loadPlayerDetail(playerId);
                        } catch (err) {
                            delBtn.disabled = false;

                            delBtn.dataset.i18n = "player.rating_delete";
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
                renameBtn.textContent = `${t('player.name_edit')}`;
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

            // Пока идёт редактирование — прячем переключатель режимов
            document.getElementById('player-mode-toggle')?.classList.add('hidden');

            // Загружаем начальные данные
            const initial = await fetchInitialRating(playerId, player.dominant_race ?? null);

            let currentDraft: RatingInput = initial;

            const handleSave = (): void => {
                void (async () => {
                    const saveBtn = actions.querySelector('.btn-primary') as HTMLButtonElement | null;
                    if (saveBtn) {
                        saveBtn.disabled = true;

                        saveBtn.dataset.i18n = "player.rating_saving";
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
        await renderPlayerHost(playerId);   // панель ведущего (если игрок — стример)
        await renderPlayerGames(playerId);   // ← НОВОЕ
        const reload = (): void => void loadPlayerDetail(playerId);
        await renderRatingsList(playerId, reload);
        await renderGivenRatingsList(playerId, Boolean(player.user_id), reload);
    } catch (err) {
        pane.innerHTML = `<p class="error fade-in">${t('common.error')}: ${err instanceof Error ? err.message : String(err)
            }</p>`;
        actions.innerHTML = '';
        ratingsContainer.innerHTML = '';
        givenRatingsContainer.innerHTML = '';
    }
}

let lastPane: HTMLElement | null = null;
let lastPlayer: PlayerWithStats | null = null;
let lastPlayerId: number | null = null;
let lastBasePlayer: PlayerWithStats | null = null;
let cardViewMode: CardViewMode = readCardViewMode();

const CARD_MODES: { mode: CardViewMode; key: TranslationKey }[] = [
    { mode: 'average', key: 'player.card_mode_average' },
    { mode: 'personal', key: 'player.card_mode_mine' },
    { mode: 'ghost', key: 'player.card_mode_ghost' },
];

function buildCardModeToggle(): void {
    const container = document.getElementById('player-mode-toggle');
    if (!container) return;
    if (lastPlayerId === null) {
        container.innerHTML = '';
        return;
    }

    container.classList.remove('hidden');
    container.innerHTML = '';

    const isAuthed = Boolean(state.token && state.user);

    for (const item of CARD_MODES) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `player-mode-btn${cardViewMode === item.mode ? ' is-active' : ''}`;
        btn.textContent = t(item.key);

        if (item.mode === 'personal' && !isAuthed) {
            btn.disabled = true;
            btn.title = t('player.login_to_rate');
        }

        btn.addEventListener('click', () => {
            if (cardViewMode === item.mode) return;
            cardViewMode = item.mode;
            localStorage.setItem(CARD_MODE_STORAGE, item.mode);
            buildCardModeToggle();
            if (lastPane && lastPlayerId !== null) {
                void renderCardForMode(lastPane, lastPlayerId, item.mode);
            }
        });

        container.appendChild(btn);
    }
}

/**
 * Shadow-ban: для пользователя, исключённого из расчёта средних, если на
 * игроке нет ни одной учитываемой оценки, показываем ему его собственную
 * оценку — чтобы карточка не была «пустой» (это выдало бы shadow-ban).
 */
async function applyShadowFallback(
    base: PlayerWithStats,
    playerId: number
): Promise<PlayerWithStats> {
    // Есть учитываемые оценки — показываем реальную среднюю.
    if (base.vote_count !== 0) return base;
    // Нужен токен, чтобы получить свою оценку.
    if (!state.token) return base;

    // Если на игроке нет учитываемых оценок (vote_count === 0) и у текущего
    // пользователя есть своя оценка — он гарантированно исключён из средних
    // (иначе его оценка была бы посчитана). Показываем ему его собственную
    // оценку, чтобы карточка не была «пустой» (это выдало бы shadow-ban).
    try {
        const res = await apiRequest<{ rating: MyRating | null }>(
            `/api/players/${playerId}/my-rating`,
            { token: state.token }
        );
        if (!res.rating) return base;

        return {
            ...base,
            races: [res.rating.race],
            vote_count: 1,
            adaptiveness: res.rating.adaptiveness,
            greed: res.rating.greed,
            survival: res.rating.survival,
            turtle: res.rating.turtle,
            aggression: res.rating.aggression,
            variety: res.rating.variety,
        };
    } catch {
        return base;
    }
}

async function renderCardForMode(
    pane: HTMLElement,
    playerId: number,
    mode: CardViewMode
): Promise<void> {
    // «Моя» недоступна без авторизации — показываем среднюю.
    if (mode === 'personal' && !(state.token && state.user)) {
        mode = 'average';
    }

    if (mode === 'average') {
        let base = lastBasePlayer;
        if (!base) {
            try {
                const { player } = await apiRequest<PlayerResponse>(`/api/players/${playerId}`);
                base = player;
                lastBasePlayer = player;
            } catch {
                return;
            }
        }
        const shown = await applyShadowFallback(base, playerId);
        renderCard(pane, shown);
        return;
    }

    try {
        const { player } = await apiRequest<PlayerResponse>(
            `/api/players/${playerId}/stats?mode=${mode}`,
            { token: state.token }
        );

        renderCard(pane, player);
    } catch {
        // При ошибке откатываемся к средней.
        if (lastBasePlayer) renderCard(pane, lastBasePlayer);
    }
}

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

function showScreen(id: string): void {
  document.querySelectorAll('.screen').forEach((s) => s.classList.add('hidden'));
  document.getElementById(id)?.classList.remove('hidden');
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

import type { PlayerGameStats, RaceStat, GameListItem, GamesListResponse } from '../types-games';
import { navigateTo } from '../router';

// ============================================================
// Секция «Ведущий игр» (стример)
// ============================================================
interface HostTopItem {
    id?: number;
    name: string;
    count: number;
}

interface PlayerHostResponse {
    host: { id: number; name: string; aka: string | null } | null;
    stats: {
        total_games: number;
        total_players: number;
        avg_players: number;
        last_played_at: string | null;
        top_maps: HostTopItem[];
        top_mods: HostTopItem[];
        top_players: HostTopItem[];
    };
}

async function renderPlayerHost(playerId: number): Promise<void> {
    const container = document.getElementById('player-host-container');
    if (!container) return;

    let res: PlayerHostResponse;
    try {
        res = await apiRequest<PlayerHostResponse>(`/api/players/${playerId}/host-stats`);
    } catch {
        container.innerHTML = `<p class="hint">${t('player.host_load_error')}</p>`;
        return;
    }

    // Игрок не привязан к ведущему — панель не показываем
    if (!res.host) {
        container.innerHTML = '';
        return;
    }

    container.innerHTML = '';
    const card = document.createElement('div');
    card.className = 'card player-host-card';

    // Заголовок
    const header = document.createElement('div');
    header.className = 'player-games-header';

    const title = document.createElement('h3');
    title.textContent = `🎙 ${res.host.name} · ${t('player.host_title')}`;

    const allLink = document.createElement('a');
    allLink.href = `/games?host=${res.host.id}`;
    allLink.className = 'player-games-all-link';
    allLink.textContent = t('player.games_all') + ' →';

    header.append(title, allLink);
    card.appendChild(header);

    const s = res.stats;

    if (s.total_games === 0) {
        const empty = document.createElement('p');
        empty.className = 'hint';
        empty.textContent = t('player.host_games_empty');
        card.appendChild(empty);
        container.appendChild(card);
        return;
    }

    // Сводка
    const summary = document.createElement('div');
    summary.className = 'player-games-summary';

    summary.appendChild(buildStatBlock(t('player.host_games_total'), String(s.total_games)));
    summary.appendChild(buildStatBlock(t('player.host_total_players'), String(s.total_players)));
    summary.appendChild(buildStatBlock(t('player.host_avg_players'), String(s.avg_players)));

    if (s.last_played_at) {
        const d = new Date(s.last_played_at);
        const date = d.toLocaleDateString(getLocale() === 'ru' ? 'ru-RU' : 'en-US', {
            day: '2-digit', month: '2-digit', year: 'numeric',
        });
        summary.appendChild(buildStatBlock(t('player.host_last_game'), date));
    }

    card.appendChild(summary);

    // Топ-5: карты, моды, игроки
    const tops = document.createElement('div');
    tops.className = 'player-host-tops';
    tops.appendChild(buildTopList(
        t('player.host_top_maps'),
        s.top_maps,
        (m) => (m.id != null ? `/games?map=${m.id}` : null)
    ));
    tops.appendChild(buildTopList(
        t('player.host_top_mods'),
        s.top_mods,
        (m) => `/games?mod=${encodeURIComponent(m.name)}`
    ));
    tops.appendChild(buildTopList(
        t('player.host_top_players'),
        s.top_players,
        (p) => `/?player=${encodeURIComponent(p.name)}`
    ));
    card.appendChild(tops);

    container.appendChild(card);
}

/** Секция «Топ-5»: столбик из имён с количеством появлений. */
function buildTopList(
    title: string,
    items: HostTopItem[],
    hrefFor: (item: HostTopItem) => string | null
): HTMLElement {
    const section = document.createElement('div');
    section.className = 'player-host-top';

    const heading = document.createElement('h4');
    heading.className = 'player-host-top-title';
    heading.textContent = title;
    section.appendChild(heading);

    const list = document.createElement('div');
    list.className = 'player-host-top-list';

    if (items.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'hint';
        empty.textContent = '—';
        list.appendChild(empty);
    } else {
        for (const item of items) {
            const href = hrefFor(item);

            const name = document.createElement('span');
            name.className = 'player-host-top-name';
            name.textContent = item.name;
            name.title = item.name; // полное имя при обрезании

            const count = document.createElement('span');
            count.className = 'player-host-top-count';
            count.textContent = `${item.count} ×`;

            if (href) {
                const a = document.createElement('a');
                a.className = 'player-host-top-row is-link';
                a.href = href;
                a.append(name, count);
                list.appendChild(a);
            } else {
                const div = document.createElement('div');
                div.className = 'player-host-top-row';
                div.append(name, count);
                list.appendChild(div);
            }
        }
    }

    section.appendChild(list);
    return section;
}

// ============================================================
// Секция «Игры игрока»
// ============================================================
async function renderPlayerGames(playerId: number): Promise<void> {
    const container = document.getElementById('player-games-container');
    if (!container) return;

    container.innerHTML = '<div class="skeleton skeleton-block" style="height: 200px;"></div>';

    try {
        const [statsRes, gamesRes] = await Promise.all([
            apiRequest<{ stats: PlayerGameStats }>(`/api/players/${playerId}/game-stats`),
            apiRequest<GamesListResponse>(`/api/games?player_id=${playerId}`),
        ]);

        const stats = statsRes.stats;
        const games = gamesRes.games;

        renderPlayerGamesContent(container, playerId, stats, games);
    } catch (err) {
        container.innerHTML = `<p class="hint">${t('player.games_load_error')}</p>`;
    }
}

function renderPlayerGamesContent(
    container: HTMLElement,
    playerId: number,
    stats: PlayerGameStats,
    games: GameListItem[]
): void {
    container.innerHTML = '';

    const card = document.createElement('div');
    card.className = 'card player-games-card';

    // Заголовок
    const header = document.createElement('div');
    header.className = 'player-games-header';

    const title = document.createElement('h3');
    title.textContent = t('player.games_title');

    const allLink = document.createElement('a');
    allLink.href = `/games?player_id=${playerId}`;
    allLink.className = 'player-games-all-link';
    allLink.textContent = t('player.games_all') + ' →';

    header.append(title, allLink);
    card.appendChild(header);

    // Если игр нет — показать сообщение и выйти
    if (stats.total_games === 0) {
        const empty = document.createElement('p');
        empty.className = 'hint';
        empty.textContent = t('player.games_empty');
        card.appendChild(empty);
        container.appendChild(card);
        return;
    }

    // Сводка
    const summary = document.createElement('div');
    summary.className = 'player-games-summary';

    summary.appendChild(buildStatBlock(
        t('player.games_total'),
        String(stats.total_games)
    ));
    summary.appendChild(buildStatBlock(
        t('player.games_wins'),
        String(stats.total_wins)
    ));
    summary.appendChild(buildStatBlock(
        t('player.games_winrate'),
        `${stats.winrate}%`
    ));
    if (stats.favorite_race) {
        const raceBlock = buildStatBlock(
            t('player.games_favorite_race'),
            stats.favorite_race
        );
        raceBlock.querySelector('.stat-value')?.classList.add(`stat-value--race-${stats.favorite_race}`);
        summary.appendChild(raceBlock);
    }
    if (stats.favorite_format) {
        summary.appendChild(buildStatBlock(
            t('player.games_favorite_format'),
            stats.favorite_format
        ));
    }

    card.appendChild(summary);

    // ============================================================
    // Статистика по расам — только если игрок играл более чем на одной
    // ============================================================
    const raceStats = stats.race_stats ?? [];
    if (raceStats.length > 1) {
        const racesTitle = document.createElement('h4');
        racesTitle.className = 'player-games-races-title';
        racesTitle.textContent = t('player.games_races_title');

        const racesGrid = document.createElement('div');
        racesGrid.className = 'player-games-races';

        for (const rs of raceStats) {
            const block = buildRaceStatBlock(rs);
            racesGrid.appendChild(block);
        }

        const racesSection = document.createElement('div');
        racesSection.className = 'player-games-races-section';
        racesSection.append(racesTitle, racesGrid);

        card.appendChild(racesSection);
    }

    // Список последних игр: показываем 3, остальные — раскрываются по кнопке
    const VISIBLE_GAMES = 3;

    const renderRow = (g: GameListItem): HTMLElement =>
        buildGameRow(
            g,
            playerId,
            g.participants.find((p) => p.player_id === playerId)?.player_name ?? ''
        );

    const list = document.createElement('div');
    list.className = 'player-games-list';

    for (const g of games.slice(0, VISIBLE_GAMES)) {
        list.appendChild(renderRow(g));
    }
    card.appendChild(list);

    if (games.length > VISIBLE_GAMES) {
        const details = document.createElement('div');
        details.className = 'player-games-details';

        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'player-games-toggle';
        toggle.textContent = t('player.games_show_all');

        const expandable = document.createElement('div');
        expandable.className = 'player-games-expandable';

        const restList = document.createElement('div');
        restList.className = 'player-games-rest';
        for (const g of games.slice(VISIBLE_GAMES)) {
            restList.appendChild(renderRow(g));
        }

        expandable.appendChild(restList);
        details.append(toggle, expandable);
        card.appendChild(details);

        toggle.addEventListener('click', () => {
            const open = details.classList.toggle('is-open');
            toggle.textContent = open
                ? t('player.games_hide_all')
                : t('player.games_show_all');
        });
    }

    container.appendChild(card);
}

function buildStatBlock(label: string, value: string): HTMLElement {
    const block = document.createElement('div');
    block.className = 'stat-block';

    const labelEl = document.createElement('div');
    labelEl.className = 'stat-label';
    labelEl.textContent = label;

    const valueEl = document.createElement('div');
    valueEl.className = 'stat-value';
    valueEl.textContent = value;

    block.append(labelEl, valueEl);
    return block;
}

function buildRaceStatBlock(rs: RaceStat): HTMLElement {
    const block = document.createElement('div');
    block.className = 'race-stat-block';

    const iconMap: Record<Race, string> = {
        T: terranIconUrl,
        Z: zergIconUrl,
        P: protossIconUrl,
        R: randomIconUrl,
    };

    const icon = document.createElement('img');
    icon.className = `race-stat-icon race-stat-icon-${rs.race}`;
    icon.src = iconMap[rs.race];
    icon.alt = rs.race;
    icon.loading = 'lazy';

    const info = document.createElement('div');
    info.className = 'race-stat-info';

    const gamesEl = document.createElement('div');
    gamesEl.className = 'race-stat-games';
    gamesEl.textContent = `${rs.games} ${t('player.games_games_word')}`;

    const winsEl = document.createElement('div');
    winsEl.className = 'race-stat-wins';
    winsEl.textContent = `${rs.wins} ${t('player.games_wins_word')} · ${rs.winrate}%`;

    info.append(gamesEl, winsEl);

    block.append(icon, info);
    return block;
}

function buildGameRow(g: GameListItem, playerId: number, playerName: string): HTMLElement {
    const row = document.createElement('a');
    row.className = 'game-row';
    row.href = `/games?q=${encodeURIComponent(playerName)}&highlight=${g.id}`;

    // Находим себя среди участников
    const me = g.participants.find((p) => p.player_id === playerId);

    // Дата
    const date = document.createElement('span');
    date.className = 'game-row-date';
    const d = new Date(g.played_at);
    date.textContent = d.toLocaleDateString(getLocale() === 'ru' ? 'ru-RU' : 'en-US', {
        day: '2-digit',
        month: '2-digit',
        year: '2-digit',
    });

    // Формат
    const format = document.createElement('span');
    format.className = 'game-row-format';
    format.textContent = g.format_name ?? '—';

    // Результат игрока
    const result = document.createElement('span');
    result.className = 'game-row-result';
    if (me) {
        if (me.is_winner) {
            result.textContent = '👑 ' + t('player.games_result_win');
            result.classList.add('is-win');
        } else if (me.eliminated_at !== null) {
            const place = g.participants.length - me.eliminated_at + 1;
            result.textContent = `#${place}`;
            result.classList.add('is-loss');
        } else {
            result.textContent = '—';
        }
    } else {
        result.textContent = '—';
    }

    // Карта
    const map = document.createElement('span');
    map.className = 'game-row-map';
    map.textContent = g.map_name ?? '';

    const delta = me ? buildPlayerDeltaBadge(me) : null;

    row.append(date, format, result, map);
    if (delta) row.insertBefore(delta, map);
    return row;
}

/** Бейдж дельт Elo и activity за игру (из rating_history) для строки игры игрока. */
function buildPlayerDeltaBadge(me: GameListItem['participants'][number]): HTMLElement | null {
    if (me.elo_delta == null && me.activity_delta == null) return null;
    const badge = document.createElement('span');
    badge.className = 'game-row-delta';

    if (me.elo_delta != null) {
        const elo = document.createElement('span');
        elo.className = 'game-row-delta-elo' + (me.elo_delta >= 0 ? ' is-plus' : ' is-minus');
        elo.textContent = `${me.elo_delta >= 0 ? '+' : ''}${me.elo_delta}`;
        badge.appendChild(elo);
    }

    if (me.activity_delta != null) {
        const act = document.createElement('span');
        act.className = 'game-row-delta-activity';
        const v = Number(me.activity_delta);
        act.textContent = `${v >= 0 ? '+' : ''}${v.toFixed(1)}`;
        badge.appendChild(act);
    }

    return badge;
}