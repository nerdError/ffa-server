import { apiRequest, apiUpload } from '../api';
import { state } from '../state';
import { t, getLocale, onLocaleChange } from '../i18n';
import {
    listRefs,
    createRef,
    type GameFormat,
    type GameHost,
    type GameMap,
    type GameMod,
} from '../api/game-refs';
import type { PlayerWithStats, PlayersListResponse } from '../types';
import type { GameListItem, GamesListResponse, GameFull } from '../types-games';
import { ensureRolesLoaded } from '../app';

// ============================================================
// Состояние модуля
// ============================================================
let abortController: AbortController | null = null;
let cachedGames: GameListItem[] = [];
let searchQuery = '';

let cachedPlayers: PlayerWithStats[] = [];
let cachedFormats: GameFormat[] = [];
let cachedHosts: GameHost[] = [];
let cachedMaps: GameMap[] = [];
let cachedMods: GameMod[] = [];

const filters = {
    formatId: null as number | null,
    hostId: null as number | null,
    mapId: null as number | null,
    playerId: null as number | null,
};

let playerFilterName: string | null = null;

// ============================================================
// Форма
// ============================================================
interface GamePlayerDraft {
    player_id: number | null;
    race: 'T' | 'Z' | 'P' | 'R';
    team: number | null;
    is_winner: boolean;
    /** Итоговое место: 1 — победитель, 2..N — остальные. null — не выбрано. */
    place: number | null;
    /** Имя из реплея — показывается в автокомплите, пока игрок не сопоставлен. */
    raw_name?: string | null;
    /** Черновик пришёл из реплея (для валидации перед сохранением). */
    from_replay?: boolean;
}

// ============================================================
// Данные, разобранные из реплея SC2
// ============================================================
interface ReplayPrefillPlayer {
    name: string | null;
    race: string | null;
    result: string | null;
    teamId: number | null;
    toon: string | null;
    /** Номер выбывания (1 = выбыл первым), null — дожил до конца. */
    eliminatedOrder?: number | null;
}

interface ReplayPrefill {
    replayId: string;
    patchVersion: string;
    build: number | null;
    durationSeconds: number;
    playedAt: string | null;
    playedAtMs: number | null;
    gameType: string | null;
    mapTitle: string | null;
    replayType: string | null;
    players: ReplayPrefillPlayer[];
}

let drafts: GamePlayerDraft[] = [];
let editingGameId: number | null = null;
let isDirty = false;

let modal: HTMLElement | null = null;
let form: HTMLFormElement | null = null;
let modalTitle: HTMLElement | null = null;
let playersListBox: HTMLElement | null = null;
let formatSelect: HTMLSelectElement | null = null;
let hostSelect: HTMLSelectElement | null = null;
let mapSelect: HTMLSelectElement | null = null;
let modSelect: HTMLSelectElement | null = null;
let playedAtInput: HTMLInputElement | null = null;
let durationInput: HTMLInputElement | null = null;
let notesInput: HTMLTextAreaElement | null = null;
let isTeamCheckbox: HTMLInputElement | null = null;
let teamSizeSelect: HTMLSelectElement | null = null;
let teamModeOptions: HTMLElement | null = null;

const LAST_GAME_KEY = 'games:lastGameSettings';

interface LastGameSettings {
    format_id: number | null;
    host_id: number | null;
    map_id: number | null;
    mod_id: number | null;
    duration_min: number | null;
    is_team: boolean;
    team_size: number;
    track_elim: boolean;
    played_at: string | null;   // ← НОВОЕ: время последней игры
    players: Array<{
        player_id: number | null;
        race: 'T' | 'Z' | 'P' | 'R';
        team: number | null;
    }>;
}

const TEAM_COLORS = [
    '#3498db',
    '#e74c3c',
    '#2ecc71',
    '#f1c40f',
    '#9b59b6',
    '#e67e22',
];

// ============================================================
// Mount / unmount
// ============================================================
export function mountGames(params: URLSearchParams): void {
    const screen = document.getElementById('screen-games');
    if (screen) screen.classList.remove('hidden');

    abortController = new AbortController();
    const { signal } = abortController;

    modal = document.getElementById('game-modal');
    form = document.getElementById('game-form') as HTMLFormElement | null;
    modalTitle = document.getElementById('game-modal-title');
    playersListBox = document.getElementById('players-list');
    formatSelect = document.getElementById('field-format') as HTMLSelectElement | null;
    hostSelect = document.getElementById('field-host') as HTMLSelectElement | null;
    mapSelect = document.getElementById('field-map') as HTMLSelectElement | null;
    modSelect = document.getElementById('field-mod') as HTMLSelectElement | null;
    playedAtInput = document.getElementById('field-played-at') as HTMLInputElement | null;
    durationInput = document.getElementById('field-duration') as HTMLInputElement | null;
    notesInput = document.getElementById('field-notes') as HTMLTextAreaElement | null;
    isTeamCheckbox = document.getElementById('field-is-team') as HTMLInputElement | null;
    teamSizeSelect = document.getElementById('field-team-size') as HTMLSelectElement | null;
    teamModeOptions = document.getElementById('team-mode-options');

    filters.formatId = params.get('format') ? Number(params.get('format')) : null;
    filters.hostId = params.get('host') ? Number(params.get('host')) : null;
    filters.mapId = params.get('map') ? Number(params.get('map')) : null;

    const playerParam = params.get('player_id');
    filters.playerId = playerParam && Number.isInteger(Number(playerParam))
        ? Number(playerParam)
        : null;
    playerFilterName = null;
    if (filters.playerId !== null) void loadPlayerFilterName(filters.playerId);

    // Проверяем роли, потом настраиваем кнопки
    void ensureRolesLoaded().then(() => {
        updateCreateButtonVisibility();
    });
    updateCreateButtonVisibility(); // первичный вызов (если роли уже есть)

    const urlQ = params.get('q');
    if (urlQ) {
        searchQuery = urlQ.toLowerCase();
        const searchInput = document.getElementById('games-search') as HTMLInputElement | null;
        if (searchInput) searchInput.value = urlQ;
    }

    const createBtn = document.getElementById('btn-create-game');
    if (createBtn && (state.user?.is_moderator || state.user?.is_admin)) {
        createBtn.removeAttribute('hidden');
        createBtn.addEventListener('click', () => {
            void openCreateGameModal();
        }, { signal });
    } else if (createBtn) {
        createBtn.setAttribute('hidden', '');
    }

    const replayBtn = document.getElementById('btn-add-from-replay');
    const replayInput = document.getElementById('replay-file-input') as HTMLInputElement | null;
    replayBtn?.addEventListener('click', () => replayInput?.click(), { signal });
    replayInput?.addEventListener('change', () => {
        const file = replayInput.files?.[0];
        if (file) void openReplayGameModal(file);
        replayInput.value = '';
    }, { signal });

    const searchInput = document.getElementById('games-search') as HTMLInputElement | null;
    searchInput?.addEventListener('input', () => {
        searchQuery = searchInput.value.trim().toLowerCase();
        renderGames();
    }, { signal });

    document.getElementById('filter-format')?.addEventListener('change', (e) => {
        const v = (e.target as HTMLSelectElement).value;
        filters.formatId = v ? Number(v) : null;
        applyFilters();
    }, { signal });

    document.getElementById('filter-host')?.addEventListener('change', (e) => {
        const v = (e.target as HTMLSelectElement).value;
        filters.hostId = v ? Number(v) : null;
        applyFilters();
    }, { signal });

    document.getElementById('filter-map')?.addEventListener('change', (e) => {
        const v = (e.target as HTMLSelectElement).value;
        filters.mapId = v ? Number(v) : null;
        applyFilters();
    }, { signal });

    document.getElementById('btn-reset-filters')?.addEventListener('click', () => {
        resetFilters();
    }, { signal });

    document.getElementById('game-modal-close')?.addEventListener('click', () => closeGameModal(), { signal });
    document.getElementById('btn-cancel-game')?.addEventListener('click', () => closeGameModal(), { signal });
    form?.addEventListener('submit', (e) => void submitGameForm(e), { signal });

    document.getElementById('btn-add-player')?.addEventListener('click', () => {
        addPlayerDraft();
    }, { signal });

    document.getElementById('btn-create-player-inline')?.addEventListener('click', () => {
        void createPlayerInline();
    }, { signal });

    document.getElementById('btn-add-map')?.addEventListener('click', () => {
        void createMapInline();
    }, { signal });

    document.getElementById('btn-add-mod')?.addEventListener('click', () => {
        void createModInline();
    }, { signal });

    document.getElementById('btn-clear-form')?.addEventListener('click', () => {
        if (!confirm(t('games.clear_form_confirm'))) return;
        clearLastGameSettings();
        void openCreateGameModal();
    }, { signal });

    document.getElementById('btn-add-5min')?.addEventListener('click', () => {
        if (!playedAtInput?.value) {
            playedAtInput!.value = toDatetimeLocal(new Date());
        }
        if (!playedAtInput) {
            alert("playedAtInput is null");
            return;
        }

        const current = new Date(playedAtInput!.value);
        current.setMinutes(current.getMinutes() + 5);
        playedAtInput!.value = toDatetimeLocal(current);
        markDirty();
    }, { signal });

    document.getElementById('btn-now')?.addEventListener('click', () => {
        if (!playedAtInput) return;
        playedAtInput.value = toDatetimeLocal(new Date());
        markDirty();
    }, { signal });

    isTeamCheckbox?.addEventListener('change', () => {
        updateTeamModeVisibility();
        redistributeTeams();
        renderPlayerDrafts();
        markDirty();
    }, { signal });

    teamSizeSelect?.addEventListener('change', () => {
        redistributeTeams();
        renderPlayerDrafts();
        markDirty();
    }, { signal });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal && !modal.classList.contains('hidden')) {
            closeGameModal();
        }
    }, { signal });

    onLocaleChange(() => {
        renderGames();
        if (modal && !modal.classList.contains('hidden')) {
            renderPlayerDrafts();
        }
    });

    void loadGames().then(() => {
        const highlightId = params.get('highlight');
        if (highlightId) highlightGame(Number(highlightId));
    });
    void setupFilterSelects();
}

function updateCreateButtonVisibility(): void {
    const createBtn = document.getElementById('btn-create-game');
    const replayBtn = document.getElementById('btn-add-from-replay');
    const allowed = Boolean(state.user?.is_moderator || state.user?.is_admin);
    if (createBtn) {
        if (allowed) createBtn.removeAttribute('hidden');
        else createBtn.setAttribute('hidden', '');
    }
    if (replayBtn) {
        if (allowed) replayBtn.removeAttribute('hidden');
        else replayBtn.setAttribute('hidden', '');
    }
}

export function unmountGames(): void {
    abortController?.abort();
    abortController = null;
}

// ============================================================
// Загрузка игр
// ============================================================
async function loadGames(): Promise<void> {
    const container = document.getElementById('games-list-container');
    const errorBox = document.getElementById('games-error');
    if (!container) return;

    container.innerHTML = '<div class="skeleton skeleton-block"></div>';
    errorBox?.classList.add('hidden');

    try {
        const url = filters.playerId !== null
            ? `/api/games?player_id=${encodeURIComponent(String(filters.playerId))}`
            : '/api/games';
        const res = await apiRequest<GamesListResponse>(url);
        cachedGames = res.games;
        renderGames();
    } catch (err) {
        if (errorBox) {
            errorBox.textContent = t('games.load_error') +
                (err instanceof Error ? err.message : String(err));
            errorBox.classList.remove('hidden');
        }
        container.innerHTML = '';
    }
}

function hasActiveFilters(): boolean {
    return filters.formatId !== null
        || filters.hostId !== null
        || filters.mapId !== null
        || filters.playerId !== null;
}

async function loadPlayerFilterName(id: number): Promise<void> {
    try {
        const res = await apiRequest<{ player: PlayerWithStats }>(`/api/players/${id}`);
        if (filters.playerId === id) {
            playerFilterName = res.player.name + (res.player.aka ? ` (${res.player.aka})` : '');
        }
    } catch {
        playerFilterName = null;
    }
    renderActiveFilterChips();
}

function renderGames(): void {
    const container = document.getElementById('games-list-container');
    if (!container) return;

    let filtered = cachedGames;

    if (filters.formatId !== null) filtered = filtered.filter((g) => g.format_id === filters.formatId);
    if (filters.hostId !== null) filtered = filtered.filter((g) => g.host_id === filters.hostId);
    if (filters.mapId !== null) filtered = filtered.filter((g) => g.map_id === filters.mapId);

    if (searchQuery) {
        filtered = filtered.filter((g) => {
            const hay = [
                ...g.winners,
                ...g.participants.map((p) => p.player_name),
                g.map_name ?? '',
                g.host_name ?? '',
            ].join(' ').toLowerCase();
            return hay.includes(searchQuery);
        });
    }

    if (filtered.length === 0) {
        container.innerHTML = `<p class="hint">${searchQuery || hasActiveFilters() ? t('games.nothing_found') : t('games.no_games')
            }</p>`;
        return;
    }

    // Группируем по дню
    const groups = groupGamesByDay(filtered);

    container.innerHTML = '';
    for (const group of groups) {
        container.appendChild(buildDayGroup(group));
    }
}

interface DayGroup {
    dateKey: string;       // YYYY-MM-DD
    dateObj: Date;
    games: GameListItem[];
    hosts: string[];       // уникальные проводящие
}

function groupGamesByDay(games: GameListItem[]): DayGroup[] {
    const map = new Map<string, DayGroup>();

    for (const g of games) {
        const d = new Date(g.played_at);
        // Ключ — локальная дата (не UTC), чтобы соответствовать тому, что видит пользователь
        const pad = (n: number) => String(n).padStart(2, '0');
        const dateKey = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

        let group = map.get(dateKey);
        if (!group) {
            group = { dateKey, dateObj: d, games: [], hosts: [] };
            map.set(dateKey, group);
        }
        group.games.push(g);
        if (g.host_name && !group.hosts.includes(g.host_name)) {
            group.hosts.push(g.host_name);
        }
    }

    // Сортируем группы по дате (от новых к старым)
    const groups = [...map.values()];
    groups.sort((a, b) => b.dateObj.getTime() - a.dateObj.getTime());

    return groups;
}

function buildDayGroup(group: DayGroup): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'game-day-group';

    // Заголовок
    const header = document.createElement('div');
    header.className = 'game-day-header';

    const date = document.createElement('div');
    date.className = 'game-day-date';
    date.textContent = formatDayHeader(group.dateObj);

    const hosts = document.createElement('div');
    hosts.className = 'game-day-hosts';
    if (group.hosts.length > 0) {
        for (const hostName of group.hosts) {
            const badge = document.createElement('span');
            badge.className = 'game-day-host-badge';
            badge.textContent = `🎤 ${hostName}`;
            hosts.appendChild(badge);
        }
    }

    header.append(date, hosts);
    wrap.appendChild(header);

    // Игры внутри дня
    const list = document.createElement('div');
    list.className = 'game-day-list';
    for (const g of group.games) {
        list.appendChild(buildGameCard(g));
    }
    wrap.appendChild(list);

    return wrap;
}

function formatDayHeader(d: Date): string {
    const locale = getLocale() === 'ru' ? 'ru-RU' : 'en-US';
    return d.toLocaleDateString(locale, {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
    });
}

// ============================================================
// Карточка игры
// ============================================================
function buildGameCard(g: GameListItem): HTMLElement {
    const card = document.createElement('div');
    card.className = 'game-card';
    card.dataset.gameId = String(g.id);
    if (g.is_team) card.classList.add('is-team');

    const header = document.createElement('div');
    header.className = 'game-card-header';

    const leftMeta = document.createElement('div');
    leftMeta.className = 'game-card-left';

    const date = document.createElement('span');
    date.className = 'game-card-date';
    const d = new Date(g.played_at);
    date.textContent = d.toLocaleString(getLocale() === 'ru' ? 'ru-RU' : 'en-US', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
    });
    leftMeta.appendChild(date);

    if (g.format_name) {
        const format = document.createElement('span');
        format.className = 'game-format-badge';
        if (g.is_team) format.classList.add('is-team');
        format.textContent = g.format_name + (g.is_team ? ` · ${t('games.team_label')}` : '');
        format.title = t('games.click_to_filter');
        format.addEventListener('click', (e) => {
            e.stopPropagation();
            if (g.format_id) setFilter('format', g.format_id);
        });
        leftMeta.appendChild(format);
    }

    header.appendChild(leftMeta);

    if (g.duration_min) {
        const duration = document.createElement('span');
        duration.className = 'game-card-duration';
        duration.textContent = `${g.duration_min} ${t('games.minutes_short')}`;
        header.appendChild(duration);
    }

    card.appendChild(header);

    const meta = document.createElement('div');
    meta.className = 'game-card-meta';

    if (g.map_name) {
        const mapEl = document.createElement('span');
        mapEl.className = 'game-clickable';
        mapEl.textContent = g.map_name;
        mapEl.title = t('games.click_to_filter');
        mapEl.addEventListener('click', (e) => {
            e.stopPropagation();
            if (g.map_id) setFilter('map', g.map_id);
        });
        meta.appendChild(mapEl);
    }

    if (g.mod_name) {
        if (meta.childNodes.length > 0) meta.appendChild(document.createTextNode(' · '));
        meta.appendChild(document.createTextNode(g.mod_name));
    }

    if (g.host_name) {
        if (meta.childNodes.length > 0) meta.appendChild(document.createTextNode(' · '));
        meta.appendChild(document.createTextNode(`${t('games.host_label')}: `));
        const hostEl = document.createElement('span');
        hostEl.className = 'game-clickable';
        hostEl.textContent = g.host_name;
        hostEl.title = t('games.click_to_filter');
        hostEl.addEventListener('click', (e) => {
            e.stopPropagation();
            if (g.host_id) setFilter('host', g.host_id);
        });
        meta.appendChild(hostEl);
    }

    card.appendChild(meta);

    const playersSummary = document.createElement('div');
    playersSummary.className = 'game-card-players-summary';

    // --- Победители / сводка ---
    if (g.is_team) {
        buildTeamSummary(playersSummary, g);
    } else {
        buildSoloSummary(playersSummary, g);
    }

    card.appendChild(playersSummary);

    // --- Раскрывающийся список всех участников ---
    const detailsWrap = document.createElement('div');
    detailsWrap.className = 'game-card-players-details';

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'game-card-players-toggle';
    toggle.textContent = `${t('games.show_all_players')} (${g.player_count})`;

    const allListWrap = document.createElement('div');
    allListWrap.className = 'game-card-players-expandable';

    const allList = document.createElement('div');
    allList.className = 'game-card-players-all';

    if (g.is_team) {
        renderTeamPlayers(allList, g);
    } else {
        renderSoloPlayers(allList, g);
    }

    allListWrap.appendChild(allList);

    toggle.addEventListener('click', () => {
        const open = detailsWrap.classList.toggle('is-open');
        toggle.textContent = open
            ? `${t('games.hide_all_players')} (${g.player_count})`
            : `${t('games.show_all_players')} (${g.player_count})`;
    });

    detailsWrap.append(toggle, allListWrap);
    card.appendChild(detailsWrap);

    const canEdit = Boolean(state.user?.is_moderator || state.user?.is_admin);
    if (canEdit) {
        const actions = document.createElement('div');
        actions.className = 'game-card-actions';

        const editBtn = document.createElement('button');
        editBtn.type = 'button';
        editBtn.className = 'game-action-btn game-action-btn--edit';
        editBtn.title = t('games.edit_game');
        editBtn.textContent = '✎';
        editBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            void openEditGameModal(g.id);
        });

        const dupBtn = document.createElement('button');
        dupBtn.type = 'button';
        dupBtn.className = 'game-action-btn game-action-btn--duplicate';
        dupBtn.title = t('games.duplicate_settings');
        dupBtn.textContent = '➕';
        dupBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            void openCreateFromGame(g.id);
        });

        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'game-action-btn game-action-btn--delete';
        delBtn.title = t('games.delete_game');
        delBtn.textContent = '🗑';
        delBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            void deleteGame(g);
        });

        actions.append(editBtn, dupBtn, delBtn);
        card.appendChild(actions);
    }

    return card;
}

/**
 * Сводка по одиночной игре: показывает только победителя (или «никто»).
 */
function buildSoloSummary(container: HTMLElement, g: GameListItem): void {
    const winners = g.participants.filter((p) => p.is_winner);
    if (winners.length === 0) {
        const empty = document.createElement('span');
        empty.className = 'game-player-summary-empty';
        empty.textContent = t('games.no_winner');
        container.appendChild(empty);
        return;
    }

    for (const p of winners) {
        const el = document.createElement('span');
        el.className = 'game-player is-winner';
        el.style.setProperty('--race-color', getRaceColor(p.race));

        const medal = document.createElement('span');
        medal.className = 'game-player-medal';
        medal.textContent = '🥇';

        const race = document.createElement('span');
        race.className = 'game-player-race';
        race.textContent = p.race;

        const name = document.createElement('span');
        name.className = 'game-player-name';
        name.textContent = p.player_name;

        el.append(medal, race, name);
        container.appendChild(el);
    }
}

/**
 * Сводка по командной игре: показывает команду-победителя и её состав,
 * а рядом — общее число команд.
 */
function buildTeamSummary(container: HTMLElement, g: GameListItem): void {
    // Группируем по team
    const teamMap = new Map<number, typeof g.participants>();
    for (const p of g.participants) {
        const tNum = p.team ?? 0;
        const arr = teamMap.get(tNum) ?? [];
        arr.push(p);
        teamMap.set(tNum, arr);
    }

    // Ищем команду-победителя
    const winnerEntry = [...teamMap.entries()].find(([_, players]) =>
        players.some((p) => p.is_winner)
    );

    if (!winnerEntry) {
        const empty = document.createElement('span');
        empty.className = 'game-player-summary-empty';
        empty.textContent = t('games.no_winner');
        container.appendChild(empty);
        return;
    }

    const [winnerTeam, winnerPlayers] = winnerEntry;

    const teamEl = document.createElement('span');
    teamEl.className = 'game-team is-winner';

    const medal = document.createElement('span');
    medal.className = 'game-player-medal';
    medal.textContent = '🥇';
    teamEl.appendChild(medal);

    const members = document.createElement('span');
    members.className = 'game-team-members';

    winnerPlayers.forEach((p, i) => {
        if (i > 0) {
            const sep = document.createElement('span');
            sep.className = 'game-player-sep';
            sep.textContent = '+';
            members.appendChild(sep);
        }

        const pEl = document.createElement('span');
        pEl.className = 'game-player';
        pEl.style.setProperty('--race-color', getRaceColor(p.race));

        const race = document.createElement('span');
        race.className = 'game-player-race';
        race.textContent = p.race;

        const name = document.createElement('span');
        name.className = 'game-player-name';
        name.textContent = p.player_name;

        pEl.append(race, name);
        members.appendChild(pEl);
    });

    teamEl.appendChild(members);
    container.appendChild(teamEl);

    // Доп. инфо: сколько всего команд
    const teamsCount = document.createElement('span');
    teamsCount.className = 'game-team-count';
    teamsCount.textContent = `${teamMap.size} ${t('games.teams_short')}`;
    container.appendChild(teamsCount);
}

function renderSoloPlayers(container: HTMLElement, g: GameListItem): void {
  const total = g.participants.length;

  // Сортируем по месту (победитель — 1), затем по имени
  const sorted = [...g.participants].sort((a, b) => {
    const pa = entryPlace(a, total) ?? Number.MAX_SAFE_INTEGER;
    const pb = entryPlace(b, total) ?? Number.MAX_SAFE_INTEGER;
    if (pa !== pb) return pa - pb;
    return a.player_name.localeCompare(b.player_name);
  });

  for (const p of sorted) {
    const place = entryPlace(p, total);
    const row = document.createElement('div');
    row.className = 'player-line';
    if (p.is_winner) row.classList.add('is-winner');
    if (!p.is_winner && place !== null) row.classList.add('is-eliminated');
    row.style.setProperty('--race-color', getRaceColor(p.race));

    // Место
    const placeEl = document.createElement('span');
    placeEl.className = 'player-line-place';
    if (place === 1) {
      placeEl.textContent = '🥇';
      placeEl.title = t('games.place_1');
    } else if (place !== null) {
      placeEl.textContent = place === 2 ? '🥈' : place === 3 ? '🥉' : `#${place}`;
      placeEl.title = formatPlace(place);
    } else {
      placeEl.textContent = '—';
      placeEl.title = t('games.not_eliminated');
    }
    row.appendChild(placeEl);

    // Раса
    const raceEl = document.createElement('span');
    raceEl.className = 'player-line-race';
    raceEl.textContent = p.race;
    row.appendChild(raceEl);

    // Имя
    const nameEl = document.createElement('span');
    nameEl.className = 'player-line-name';
    nameEl.textContent = p.player_name;
    if (p.player_aka) nameEl.title = `aka ${p.player_aka}`;
    row.appendChild(nameEl);

    container.appendChild(row);
  }
}

function renderTeamPlayers(container: HTMLElement, g: GameListItem): void {
  const teamMap = new Map<number, typeof g.participants>();
  for (const p of g.participants) {
    const teamNum = p.team ?? 0;
    const arr = teamMap.get(teamNum) ?? [];
    arr.push(p);
    teamMap.set(teamNum, arr);
  }

  const totalTeams = teamMap.size;

  // Формируем команды с их местом
  const teams: { teamNum: number; players: typeof g.participants; place: number; isWinner: boolean }[] = [];
  for (const [teamNum, players] of teamMap.entries()) {
    const isWinner = players.some((p) => p.is_winner);
    const ref = players.find((p) => p.eliminated_at !== null) ?? null;
    let place: number;
    if (isWinner) place = 1;
    else place = ref ? totalTeams - ref.eliminated_at! + 1 : 2;
    teams.push({ teamNum, players, place, isWinner });
  }

  // Сортируем: победители (1), не выбывшие (2), выбывшие по убыванию места
  teams.sort((a, b) => {
    if (a.place !== b.place) return a.place - b.place;
    return a.teamNum - b.teamNum;
  });

  for (const team of teams) {
    const teamRow = document.createElement('div');
    teamRow.className = 'player-team-line';
    if (team.isWinner) teamRow.classList.add('is-winner');
    if (team.players.some((p) => p.eliminated_at !== null)) {
      teamRow.classList.add('is-eliminated');
    }

    // Место команды
    const placeEl = document.createElement('span');
    placeEl.className = 'player-line-place';
    if (team.place === 1) placeEl.textContent = '🥇';
    else if (team.place === 2) placeEl.textContent = '🥈';
    else if (team.place === 3) placeEl.textContent = '🥉';
    else placeEl.textContent = `#${team.place}`;
    teamRow.appendChild(placeEl);

    // Состав команды
    const membersEl = document.createElement('span');
    membersEl.className = 'player-team-members';

    team.players.forEach((p, i) => {
      if (i > 0) {
        const sep = document.createElement('span');
        sep.className = 'player-line-sep';
        sep.textContent = '+';
        membersEl.appendChild(sep);
      }

      const m = document.createElement('span');
      m.className = 'player-line-member';
      m.style.setProperty('--race-color', getRaceColor(p.race));

      const raceEl = document.createElement('span');
      raceEl.className = 'player-line-race';
      raceEl.textContent = p.race;
      m.appendChild(raceEl);

      const nameEl = document.createElement('span');
      nameEl.className = 'player-line-name';
      nameEl.textContent = p.player_name;
      m.appendChild(nameEl);

      membersEl.appendChild(m);
    });

    teamRow.appendChild(membersEl);
    container.appendChild(teamRow);
  }
}

function getRaceColor(race: string): string {
    switch (race) {
        case 'T': return 'var(--race-terran)';
        case 'Z': return 'var(--race-zerg)';
        case 'P': return 'var(--race-protoss)';
        case 'R': return 'var(--race-random)';
        default: return 'var(--text-secondary)';
    }
}

function highlightGame(gameId: number): void {
    const container = document.getElementById('games-list-container');
    if (!container || !Number.isInteger(gameId)) return;
    const card = container.querySelector<HTMLElement>(`[data-game-id="${gameId}"]`);
    if (!card) return;
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    card.classList.add('is-highlighted');
    setTimeout(() => card.classList.remove('is-highlighted'), 3000);
}

// ============================================================
// Фильтры
// ============================================================
async function setupFilterSelects(): Promise<void> {
    try {
        if (cachedFormats.length === 0 || cachedHosts.length === 0 || cachedMaps.length === 0) {
            const [formats, hosts, maps] = await Promise.all([
                listRefs<GameFormat>('formats'),
                listRefs<GameHost>('hosts'),
                listRefs<GameMap>('maps'),
            ]);
            cachedFormats = formats;
            cachedHosts = hosts;
            cachedMaps = maps;
        }

        fillFilterSelect('filter-format', cachedFormats);
        fillFilterSelect('filter-host', cachedHosts);
        fillFilterSelect('filter-map', cachedMaps);

        const formatSel = document.getElementById('filter-format') as HTMLSelectElement | null;
        const hostSel = document.getElementById('filter-host') as HTMLSelectElement | null;
        const mapSel = document.getElementById('filter-map') as HTMLSelectElement | null;

        if (formatSel && filters.formatId !== null) formatSel.value = String(filters.formatId);
        if (hostSel && filters.hostId !== null) hostSel.value = String(filters.hostId);
        if (mapSel && filters.mapId !== null) mapSel.value = String(filters.mapId);

        renderActiveFilterChips();
    } catch (err) {
        console.error('[games] failed to load refs for filters:', err);
    }
}

function fillFilterSelect(selectId: string, items: { id: number; name: string }[]): void {
    const select = document.getElementById(selectId) as HTMLSelectElement | null;
    if (!select) return;
    const currentValue = select.value;
    select.innerHTML = '';
    const allOpt = document.createElement('option');
    allOpt.value = '';
    allOpt.textContent = t('games.filter_all');
    select.appendChild(allOpt);
    for (const item of items) {
        const opt = document.createElement('option');
        opt.value = String(item.id);
        opt.textContent = item.name;
        select.appendChild(opt);
    }
    select.value = currentValue;
}

function applyFilters(): void {
    updateUrlFromFilters();
    renderGames();
    renderActiveFilterChips();
}

function resetFilters(): void {
    const hadPlayer = filters.playerId !== null;
    filters.formatId = null;
    filters.hostId = null;
    filters.mapId = null;
    filters.playerId = null;
    playerFilterName = null;
    const formatSel = document.getElementById('filter-format') as HTMLSelectElement | null;
    const hostSel = document.getElementById('filter-host') as HTMLSelectElement | null;
    const mapSel = document.getElementById('filter-map') as HTMLSelectElement | null;
    if (formatSel) formatSel.value = '';
    if (hostSel) hostSel.value = '';
    if (mapSel) mapSel.value = '';

    if (hadPlayer) {
        updateUrlFromFilters();
        renderActiveFilterChips();
        void loadGames();
    } else {
        applyFilters();
    }
}

function removePlayerFilter(): void {
    filters.playerId = null;
    playerFilterName = null;
    updateUrlFromFilters();
    renderActiveFilterChips();
    void loadGames();
}

function updateUrlFromFilters(): void {
    const url = new URL(window.location.href);
    if (filters.formatId !== null) url.searchParams.set('format', String(filters.formatId));
    else url.searchParams.delete('format');
    if (filters.hostId !== null) url.searchParams.set('host', String(filters.hostId));
    else url.searchParams.delete('host');
    if (filters.mapId !== null) url.searchParams.set('map', String(filters.mapId));
    else url.searchParams.delete('map');
    if (filters.playerId !== null) url.searchParams.set('player_id', String(filters.playerId));
    else url.searchParams.delete('player_id');
    window.history.replaceState({}, '', url.pathname + url.search);
}

function setFilter(type: 'format' | 'host' | 'map', id: number): void {
    if (type === 'format') filters.formatId = id;
    if (type === 'host') filters.hostId = id;
    if (type === 'map') filters.mapId = id;
    const selectId = type === 'format' ? 'filter-format' : type === 'host' ? 'filter-host' : 'filter-map';
    const sel = document.getElementById(selectId) as HTMLSelectElement | null;
    if (sel) sel.value = String(id);
    applyFilters();
}

function renderActiveFilterChips(): void {
    const container = document.getElementById('games-active-filters');
    const resetBtn = document.getElementById('btn-reset-filters');
    if (!container) return;
    container.innerHTML = '';
    const chips: { label: string; value: string; onRemove: () => void }[] = [];

    if (filters.playerId !== null) {
        chips.push({
            label: t('games.filter_player'),
            value: playerFilterName ?? `#${filters.playerId}`,
            onRemove: () => removePlayerFilter(),
        });
    }

    if (filters.formatId !== null) {
        const f = cachedFormats.find((x) => x.id === filters.formatId);
        if (f) chips.push({
            label: t('games.filter_format'),
            value: f.name,
            onRemove: () => {
                filters.formatId = null;
                const sel = document.getElementById('filter-format') as HTMLSelectElement | null;
                if (sel) sel.value = '';
                applyFilters();
            },
        });
    }

    if (filters.hostId !== null) {
        const h = cachedHosts.find((x) => x.id === filters.hostId);
        if (h) chips.push({
            label: t('games.filter_host'),
            value: h.name,
            onRemove: () => {
                filters.hostId = null;
                const sel = document.getElementById('filter-host') as HTMLSelectElement | null;
                if (sel) sel.value = '';
                applyFilters();
            },
        });
    }

    if (filters.mapId !== null) {
        const m = cachedMaps.find((x) => x.id === filters.mapId);
        if (m) chips.push({
            label: t('games.filter_map'),
            value: m.name,
            onRemove: () => {
                filters.mapId = null;
                const sel = document.getElementById('filter-map') as HTMLSelectElement | null;
                if (sel) sel.value = '';
                applyFilters();
            },
        });
    }

    if (resetBtn) resetBtn.hidden = chips.length === 0;

    for (const chip of chips) {
        const el = document.createElement('div');
        el.className = 'filter-chip';
        const label = document.createElement('span');
        label.className = 'filter-chip-label';
        label.textContent = chip.label + ':';
        const value = document.createElement('span');
        value.className = 'filter-chip-value';
        value.textContent = chip.value;
        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'filter-chip-remove';
        removeBtn.textContent = '✕';
        removeBtn.addEventListener('click', chip.onRemove);
        el.append(label, value, removeBtn);
        container.appendChild(el);
    }
}

// ============================================================
// Справочники
// ============================================================
async function ensureAllRefsLoaded(): Promise<void> {
    const needReload =
        cachedFormats.length === 0 ||
        cachedHosts.length === 0 ||
        cachedMaps.length === 0 ||
        cachedMods.length === 0;
    if (!needReload) return;

    try {
        const [formats, hosts, maps, mods] = await Promise.all([
            listRefs<GameFormat>('formats'),
            listRefs<GameHost>('hosts'),
            listRefs<GameMap>('maps'),
            listRefs<GameMod>('mods'),
        ]);
        cachedFormats = formats;
        cachedHosts = hosts;
        cachedMaps = maps;
        cachedMods = mods;
    } catch (err) {
        console.error('[games] failed to load refs:', err);
    }
}

async function refreshPlayersCache(): Promise<void> {
    try {
        const res = await apiRequest<PlayersListResponse>('/api/players');
        cachedPlayers = res.players;
    } catch (err) {
        console.error('[games] failed to refresh players:', err);
    }
}

function fillSelect(
    select: HTMLSelectElement | null,
    items: { id: number; name: string }[],
    placeholder: string
): void {
    if (!select) return;
    select.innerHTML = '';
    const empty = document.createElement('option');
    empty.value = '';
    empty.disabled = true;
    empty.selected = true;
    empty.textContent = placeholder;
    select.appendChild(empty);
    for (const item of items) {
        const opt = document.createElement('option');
        opt.value = String(item.id);
        opt.textContent = item.name;
        select.appendChild(opt);
    }
}

function toDatetimeLocal(date: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return (
        `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
        `T${pad(date.getHours())}:${pad(date.getMinutes())}`
    );
}

function getPlaceSuffix(place: number): string {
    if (getLocale() === 'ru') return '-е место';
    const mod10 = place % 10;
    const mod100 = place % 100;
    if (mod10 === 1 && mod100 !== 11) return 'st place';
    if (mod10 === 2 && mod100 !== 12) return 'nd place';
    if (mod10 === 3 && mod100 !== 13) return 'rd place';
    return 'th place';
}

function formatPlace(place: number): string {
    return `${place}${getPlaceSuffix(place)}`;
}

/**
 * Место из записи участника. `eliminated_at` в БД хранит порядок выбывания
 * (1 — выбыл первым), поэтому место = scale - eliminated_at + 1.
 */
function entryPlace(
    p: { is_winner: boolean; eliminated_at: number | null },
    scale: number
): number | null {
    if (p.is_winner) return 1;
    if (p.eliminated_at === null) return null;
    return scale - p.eliminated_at + 1;
}

/** Обратное преобразование: место → порядок выбывания (для записи в БД). */
function placeToElim(place: number | null, scale: number): number | null {
    if (place === null || place <= 1) return null;
    return scale - place + 1;
}

function markDirty(): void { isDirty = true; }

function confirmClose(): boolean {
    if (!isDirty) return true;
    return confirm(t('games.confirm_close'));
}

function isTeamMode(): boolean {
    return Boolean(isTeamCheckbox?.checked);
}

function isTrackElim(): boolean {
    // Места теперь обязательны для всех, кроме победителя, поэтому учёт
    // выбывания всегда включён.
    return true;
}

function updateTeamModeVisibility(): void {
    const enabled = isTeamMode();
    if (teamModeOptions) teamModeOptions.hidden = !enabled;
}

// ============================================================
// Сохранение последней игры
// ============================================================
function saveLastGameSettings(): void {
    try {
        const settings: LastGameSettings = {
            format_id: formatSelect?.value ? Number(formatSelect.value) : null,
            host_id: hostSelect?.value ? Number(hostSelect.value) : null,
            map_id: mapSelect?.value ? Number(mapSelect.value) : null,
            mod_id: modSelect?.value ? Number(modSelect.value) : null,
            duration_min: durationInput?.value ? Number(durationInput.value) : null,
            is_team: isTeamMode(),
            team_size: Number(teamSizeSelect?.value ?? '2'),
            track_elim: isTrackElim(),
            played_at: playedAtInput?.value ?? null,   // ← НОВОЕ
            players: drafts
                .filter((d) => d.player_id !== null)
                .map((d) => ({
                    player_id: d.player_id,
                    race: d.race,
                    team: d.team,
                })),
        };
        localStorage.setItem(LAST_GAME_KEY, JSON.stringify(settings));
    } catch (err) {
        console.warn('[games] failed to save last game settings:', err);
    }
}

function loadLastGameSettings(): LastGameSettings | null {
    try {
        const raw = localStorage.getItem(LAST_GAME_KEY);
        if (!raw) return null;
        return JSON.parse(raw) as LastGameSettings;
    } catch {
        return null;
    }
}

function clearLastGameSettings(): void {
    try {
        localStorage.removeItem(LAST_GAME_KEY);
    } catch { }
}

// ============================================================
// Создание карты/мода/игрока inline
// ============================================================
/** Нормализует название справочника для сопоставления. */
function normalizeRefName(name: string): string {
    return name.trim().toLowerCase().replace(/\.sc2map$/i, '');
}

/**
 * Ищет карту по названию в кэше справочника. Если не найдена — создаёт
 * новую через API и добавляет в кэш. Возвращает карту или null при ошибке.
 */
async function findOrCreateMapByName(name: string): Promise<GameMap | null> {
    const target = normalizeRefName(name);
    if (!target) return null;

    const existing = cachedMaps.find((m) => normalizeRefName(m.name) === target);
    if (existing) return existing;

    try {
        const created = await createRef<GameMap>('maps', { name: name.trim() }, state.token);
        cachedMaps = [...cachedMaps, created].sort((a, b) => a.name.localeCompare(b.name));
        fillSelect(mapSelect, cachedMaps, t('games.select_placeholder'));
        return created;
    } catch (err) {
        console.warn('[games] auto-create map failed:', err);
        return null;
    }
}

async function createMapInline(): Promise<void> {
    const name = prompt(t('games.new_map_prompt'));
    if (name === null) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
        const newMap = await createRef<GameMap>('maps', { name: trimmed }, state.token);
        cachedMaps = [...cachedMaps, newMap];
        cachedMaps.sort((a, b) => a.name.localeCompare(b.name));
        fillSelect(mapSelect, cachedMaps, t('games.select_placeholder'));
        if (mapSelect) mapSelect.value = String(newMap.id);
        markDirty();
    } catch (err) {
        alert(t('games.new_map_error') + (err instanceof Error ? err.message : String(err)));
    }
}

async function createModInline(): Promise<void> {
    const name = prompt(t('games.new_mod_prompt'));
    if (name === null) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
        const newMod = await createRef<GameMod>('mods', { name: trimmed }, state.token);
        cachedMods = [...cachedMods, newMod];
        cachedMods.sort((a, b) => a.name.localeCompare(b.name));
        fillSelect(modSelect, cachedMods, t('games.select_placeholder'));
        if (modSelect) modSelect.value = String(newMod.id);
        markDirty();
    } catch (err) {
        alert(t('games.new_mod_error') + (err instanceof Error ? err.message : String(err)));
    }
}

async function createPlayerInline(): Promise<void> {
    const name = prompt(t('games.new_player_prompt'));
    if (name === null) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
        const res = await apiRequest<{ player: PlayerWithStats }>('/api/players', {
            method: 'POST',
            token: state.token,
            body: { name: trimmed },
        });
        cachedPlayers.push(res.player);
        cachedPlayers.sort((a, b) => a.name.localeCompare(b.name));
        // Перерисовываем список — новые автокомплиты подхватят кэш
        renderPlayerDrafts();
    } catch (err) {
        alert(t('games.new_player_error') + (err instanceof Error ? err.message : String(err)));
    }
}

// ============================================================
// Управление черновиками
// ============================================================
function getTeamSize(): number {
    return Number(teamSizeSelect?.value ?? '2');
}

function getMaxTeams(): number {
    const total = drafts.length;
    const size = getTeamSize();
    if (size <= 0) return 1;
    return Math.max(1, Math.floor(total / size));
}

/**
 * Назначает команду для draft так, чтобы в ней было меньше teamSize игроков.
 */
function pickTeamForDraft(draft: GamePlayerDraft, teamSize: number, maxTeams: number): number | null {
    const counts: Record<number, number> = {};
    for (const d of drafts) {
        if (d === draft) continue;
        if (d.team !== null) counts[d.team] = (counts[d.team] ?? 0) + 1;
    }
    for (let teamNum = 1; teamNum <= maxTeams; teamNum++) {
        if ((counts[teamNum] ?? 0) < teamSize) return teamNum;
    }
    return null;
}

/**
 * Перераспределяет всех игроков по командам равномерно, если это командный режим.
 */
function redistributeTeams(): void {
    if (!isTeamMode()) {
        for (const d of drafts) d.team = null;
        return;
    }
    const teamSize = getTeamSize();
    const maxTeams = getMaxTeams();
    drafts.forEach((d, i) => {
        d.team = Math.floor(i / teamSize) + 1;
        if (d.team > maxTeams) d.team = maxTeams; // на случай переполнения
    });
}

function addPlayerDraft(): void {
    const newDraft: GamePlayerDraft = {
        player_id: null,
        race: 'T',
        team: null,
        is_winner: false,
        place: null,
    };
    drafts.push(newDraft);
    if (isTeamMode()) {
        const teamSize = getTeamSize();
        const maxTeams = getMaxTeams();
        newDraft.team = pickTeamForDraft(newDraft, teamSize, maxTeams) ?? 1;
    }
    renderPlayerDrafts();
    markDirty();
}

// ============================================================
// Нормализация мест
// ============================================================
function normalizePlaces(): void {
    for (const d of drafts) {
        if (d.is_winner) d.place = 1;
    }

    // В командном режиме победитель помечает всю команду, место — общее.
    if (isTeamMode()) {
        const byTeam = new Map<number, GamePlayerDraft[]>();
        for (const d of drafts) {
            const tn = d.team ?? 0;
            const arr = byTeam.get(tn) ?? [];
            arr.push(d);
            byTeam.set(tn, arr);
        }
        for (const team of byTeam.values()) {
            if (team.some((p) => p.is_winner)) {
                for (const p of team) {
                    p.is_winner = true;
                    p.place = 1;
                }
            }
        }
    }
}

// ============================================================
// Список участников в форме
// ============================================================
function renderPlayerDrafts(): void {
    if (!playersListBox) return;
    playersListBox.innerHTML = '';

    const teamMode = isTeamMode();
    const teamSize = teamMode ? getTeamSize() : 0;
    const maxTeams = teamMode ? getMaxTeams() : 0;

    if (teamMode) {
        // Группируем по командам
        const teams = new Map<number, number[]>();
        drafts.forEach((d, i) => {
            if (d.team === null || d.team < 1 || d.team > maxTeams) {
                let assigned = false;
                for (let t = 1; t <= maxTeams; t++) {
                    const members = teams.get(t) ?? [];
                    if (members.length < teamSize) {
                        d.team = t;
                        assigned = true;
                        break;
                    }
                }
                if (!assigned) d.team = 1;
            }
            const t = d.team!;
            const arr = teams.get(t) ?? [];
            arr.push(i);
            teams.set(t, arr);
        });

        const sortedTeams = [...teams.keys()].sort((a, b) => a - b);
        for (const teamNum of sortedTeams) {
            const indices = teams.get(teamNum) ?? [];
            const color = getTeamColor(teamNum);
            const allWinners = indices.every((i) => drafts[i]?.is_winner);
            const someWinners = indices.some((i) => drafts[i]?.is_winner);

            const group = document.createElement('div');
            group.className = 'team-group';
            if (allWinners) group.classList.add('is-winner');
            group.style.setProperty('--team-color', color);

            // --- Заголовок группы ---
            const header = document.createElement('div');
            header.className = 'team-group-header';

            const headerLabel = document.createElement('span');
            headerLabel.className = 'team-group-label';
            headerLabel.textContent = `${t('games.team_label')} ${teamNum}`;
            header.appendChild(headerLabel);

            // Победитель / предупреждение
            if (allWinners) {
                const crown = document.createElement('span');
                crown.className = 'team-group-winner';
                crown.textContent = '👑';
                header.appendChild(crown);
            } else if (someWinners) {
                const warn = document.createElement('span');
                warn.className = 'team-group-warning';
                warn.textContent = '⚠';
                warn.title = t('games.error_incomplete_winner_team');
                header.appendChild(warn);
            }

            // Селект места для команды (кроме команды-победителя)
            if (!allWinners) {
                const teamPlaceSelect = document.createElement('select');
                teamPlaceSelect.className = 'team-elim-select';

                const noPlace = document.createElement('option');
                noPlace.value = '';
                noPlace.textContent = '—';
                teamPlaceSelect.appendChild(noPlace);

                const teamCount = sortedTeams.length;
                const currentPlace =
                    indices.map((i) => drafts[i]?.place).find((x) => x !== null && x > 1) ?? null;

                // Занятые другими командами места
                const usedPlaces = new Set<number>();
                for (const [otherTeam, otherIndices] of teams.entries()) {
                    if (otherTeam === teamNum) continue;
                    for (const oi of otherIndices) {
                        const d = drafts[oi];
                        if (d && d.place !== null && d.place > 1) usedPlaces.add(d.place);
                    }
                }

                for (let place = 2; place <= teamCount; place++) {
                    const opt = document.createElement('option');
                    opt.value = String(place);
                    if (currentPlace === place) {
                        opt.selected = true;
                        opt.textContent = formatPlace(place);
                    } else if (usedPlaces.has(place)) {
                        opt.disabled = true;
                        opt.textContent = `${formatPlace(place)} — ${t('games.used')}`;
                    } else {
                        opt.textContent = formatPlace(place);
                    }
                    teamPlaceSelect.appendChild(opt);
                }

                teamPlaceSelect.addEventListener('change', () => {
                    const v = teamPlaceSelect.value;
                    const place = v === '' ? null : Number(v);
                    for (const i of indices) {
                        const d = drafts[i];
                        if (d && !d.is_winner) d.place = place;
                    }
                    markDirty();
                });

                header.appendChild(teamPlaceSelect);
            }

            group.appendChild(header);

            // --- Игроки команды ---
            for (const idx of indices) {
                const row = buildPlayerRow(idx, maxTeams, true);
                group.appendChild(row);
            }

            playersListBox.appendChild(group);
        }
    } else {
        // Одиночный режим
        for (let i = 0; i < drafts.length; i++) {
            const row = buildPlayerRow(i, 0, false);
            playersListBox.appendChild(row);
        }
    }
}

function getTeamColor(teamNum: number): string {
    return TEAM_COLORS[(teamNum - 1) % TEAM_COLORS.length] ?? '#8899aa';
}

/**
 * Строит строку участника.
 */
function buildPlayerRow(index: number, maxTeams: number, teamMode: boolean): HTMLElement {
    const draft = drafts[index];
    if (!draft) return document.createElement('div');

    const totalPlayers = drafts.length;

    const row = document.createElement('div');
    row.className = 'player-entry';
    if (teamMode) row.classList.add('is-team-mode');
    if (draft.is_winner) row.classList.add('is-winner');

    // --- Автокомплит игрока ---
    const { wrapper: autocompleteWrap } = createPlayerAutocomplete(
        draft,
        () => markDirty(),
        (player) => {
            if (player.dominant_race) {
                draft.race = player.dominant_race;
                const raceEl = row.querySelector('.race-select') as HTMLSelectElement | null;
                if (raceEl) raceEl.value = player.dominant_race;
            }
        }
    );

    // Игрок из реплея ещё не сопоставлен с базой — подсветить
    if (!draft.player_id && draft.raw_name) {
        autocompleteWrap.classList.add('is-unmatched');
        autocompleteWrap.title = t('games.replay_player_unmatched');
    }

    // --- Раса ---
    const raceSelect = document.createElement('select');
    raceSelect.className = 'race-select';
    for (const r of ['T', 'Z', 'P', 'R']) {
        const opt = document.createElement('option');
        opt.value = r;
        opt.textContent = r;
        if (draft.race === r) opt.selected = true;
        raceSelect.appendChild(opt);
    }
    raceSelect.addEventListener('change', () => {
        draft.race = raceSelect.value as 'T' | 'Z' | 'P' | 'R';
        markDirty();
    });

    // --- Победитель ---
    const winnerWrap = document.createElement('label');
    winnerWrap.className = 'winner-checkbox';
    const winnerCheck = document.createElement('input');
    winnerCheck.type = 'checkbox';
    winnerCheck.checked = draft.is_winner;
    winnerCheck.addEventListener('change', () => {
        draft.is_winner = winnerCheck.checked;
        draft.place = winnerCheck.checked ? 1 : null;
        renderPlayerDrafts();
        markDirty();
    });
    winnerWrap.appendChild(winnerCheck);
    const winnerText = document.createElement('span');
    winnerText.textContent = t('games.winner_label');
    winnerWrap.appendChild(winnerText);

    // --- Место (только для одиночного режима) ---
    let placeSelect: HTMLSelectElement | null = null;
    if (!teamMode) {
        placeSelect = document.createElement('select');
        placeSelect.className = 'elim-select';

        const noPlace = document.createElement('option');
        noPlace.value = '';
        noPlace.textContent = '—';
        placeSelect.appendChild(noPlace);

        if (!draft.is_winner) {
            const maxPlace = Math.max(2, totalPlayers);
            const usedPlaces = new Set(
                drafts
                    .filter((d) => d !== draft && !d.is_winner && d.place !== null)
                    .map((d) => d.place!)
            );

            for (let place = 2; place <= maxPlace; place++) {
                const opt = document.createElement('option');
                opt.value = String(place);
                if (draft.place === place) {
                    opt.selected = true;
                    opt.textContent = formatPlace(place);
                } else if (usedPlaces.has(place)) {
                    opt.disabled = true;
                    opt.textContent = `${formatPlace(place)} — ${t('games.used')}`;
                } else {
                    opt.textContent = formatPlace(place);
                }
                placeSelect.appendChild(opt);
            }

            if (draft.place === null || draft.place <= 1) placeSelect.value = '';

            const ps = placeSelect;
            ps.addEventListener('change', () => {
                const v = ps.value;
                draft.place = v === '' ? null : Number(v);
                markDirty();
            });
        } else {
            placeSelect.style.visibility = 'hidden';
            placeSelect.disabled = true;
        }
    }

    // --- Удалить ---
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'remove-player';
    removeBtn.textContent = '✕';
    removeBtn.title = t('games.remove_player');
    removeBtn.addEventListener('click', () => {
        drafts.splice(index, 1);
        if (isTeamMode()) redistributeTeams();
        renderPlayerDrafts();
        markDirty();
    });

    row.append(autocompleteWrap, raceSelect, winnerWrap);
    if (placeSelect) row.appendChild(placeSelect);
    row.appendChild(removeBtn);

    return row;
}

// ============================================================
// Автокомплит игроков
// ============================================================
function createPlayerAutocomplete(
    draft: GamePlayerDraft,
    onSelect: () => void,
    onPlayerSelected: (player: PlayerWithStats) => void
): { wrapper: HTMLElement; refresh: () => void } {
    const wrapper = document.createElement('div');
    wrapper.className = 'player-autocomplete';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'player-name-input';
    input.placeholder = t('games.player_placeholder');
    input.autocomplete = 'off';

    const dropdown = document.createElement('div');
    dropdown.className = 'player-autocomplete-dropdown hidden';

    wrapper.append(input, dropdown);

    let selectedPlayerId: number | null = draft.player_id;
    let highlightedIndex = -1;
    let matches: PlayerWithStats[] = [];

    function refresh(): void {
        const player = cachedPlayers.find((p) => p.id === selectedPlayerId);
        input.value = player ? player.name : (draft.raw_name ?? '');
    }

    function showDropdown(query: string): void {
        const q = query.trim().toLowerCase();
        if (!q) { dropdown.classList.add('hidden'); matches = []; return; }
        matches = cachedPlayers
            .filter((p) => p.name.toLowerCase().includes(q) || (p.aka ?? '').toLowerCase().includes(q))
            .slice(0, 10);
        if (matches.length === 0) {
            dropdown.innerHTML = `<div class="player-autocomplete-empty">${t('games.player_not_found')}</div>`;
            dropdown.classList.remove('hidden');
            return;
        }
        dropdown.innerHTML = '';
        matches.forEach((p, i) => {
            const item = document.createElement('div');
            item.className = 'player-autocomplete-item';
            if (i === highlightedIndex) item.classList.add('is-highlighted');
            const name = document.createElement('span');
            name.className = 'player-autocomplete-name';
            name.textContent = p.name;
            item.appendChild(name);
            if (p.aka) {
                const aka = document.createElement('span');
                aka.className = 'player-autocomplete-aka';
                aka.textContent = ` aka ${p.aka}`;
                item.appendChild(aka);
            }
            item.addEventListener('mousedown', (e) => {
                e.preventDefault();
                selectPlayer(p);
            });
            dropdown.appendChild(item);
        });
        dropdown.classList.remove('hidden');
    }

    function selectPlayer(p: PlayerWithStats): void {
        selectedPlayerId = p.id;
        draft.player_id = p.id;
        draft.raw_name = p.name;
        input.value = p.name;
        dropdown.classList.add('hidden');
        highlightedIndex = -1;
        onPlayerSelected(p);
        onSelect();
    }

    input.addEventListener('input', () => {
        const currentPlayer = cachedPlayers.find((p) => p.id === selectedPlayerId);
        if (!currentPlayer || currentPlayer.name !== input.value) {
            selectedPlayerId = null;
            draft.player_id = null;
        }
        draft.raw_name = input.value;
        highlightedIndex = -1;
        showDropdown(input.value);
        onSelect();
    });

    input.addEventListener('focus', () => {
        if (input.value.trim()) showDropdown(input.value);
    });

    input.addEventListener('blur', () => {
        setTimeout(() => {
            dropdown.classList.add('hidden');
            if (selectedPlayerId === null) input.value = draft.raw_name ?? '';
        }, 150);
    });

    input.addEventListener('keydown', (e) => {
        if (dropdown.classList.contains('hidden')) return;
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            highlightedIndex = Math.min(highlightedIndex + 1, matches.length - 1);
            showDropdown(input.value);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            highlightedIndex = Math.max(highlightedIndex - 1, -1);
            showDropdown(input.value);
        } else if (e.key === 'Enter') {
            if (highlightedIndex >= 0) {
                e.preventDefault();
                const p = matches[highlightedIndex];
                if (p) selectPlayer(p);
            }
        } else if (e.key === 'Escape') {
            dropdown.classList.add('hidden');
        }
    });

    refresh();
    return { wrapper, refresh };
}

// ============================================================
// Модалки
// ============================================================

// ------------------------------------------------------------
// Импорт игры из реплея SC2
// ------------------------------------------------------------
function normalizeReplayRace(race: string | null | undefined): 'T' | 'Z' | 'P' | 'R' {
    const s = (race ?? '').trim().toLowerCase();
    if (!s) return 'T';
    // Реплей отдаёт название расы на языке игры — понимаем и латиницу, и кириллицу
    if (s.startsWith('z') || s.startsWith('зерг')) return 'Z';
    if (s.startsWith('p') || s.startsWith('протосс')) return 'P';
    if (s.startsWith('r') || s.startsWith('случайн') || s.startsWith('рандом')) return 'R';
    if (s.startsWith('t') || s.startsWith('терр')) return 'T';
    return 'T';
}

/**
 * Убирает клан-тег из ника SC2: `<FFA> Name`, `[FFA] Name`, `{FFA} Name`, `|FFA| Name`.
 * Если после снятия тега ничего не осталось — возвращает исходное имя.
 */
function stripClanTag(name: string): string {
    let s = name.trim();
    let prev = '';
    while (s && prev !== s) {
        prev = s;
        s = s.replace(/^(<[^<>]{1,24}>|\[[^\[\]]{1,24}\]|\{[^{}]{1,24}\}|\|[^|]{1,24}\|)\s*/, '').trim();
    }
    return s || name.trim();
}

function matchCachedPlayer(name: string | null): PlayerWithStats | undefined {
    if (!name) return undefined;
    const full = name.trim();
    if (!full) return undefined;
    const clean = stripClanTag(full);
    const candidates = new Set([full.toLowerCase(), clean.toLowerCase()]);

    return cachedPlayers.find((p) => {
        const pName = p.name.trim().toLowerCase();
        const pAka = (p.aka ?? '').trim().toLowerCase();
        return candidates.has(pName)
            || (pAka !== '' && candidates.has(pAka))
            || candidates.has(stripClanTag(p.name).toLowerCase())
            || (pAka !== '' && candidates.has(stripClanTag(p.aka ?? '').toLowerCase()));
    });
}

/**
 * Заполняет открытую форму данными из реплея.
 * Формат/ведущий/мод остаются из последних настроек — их в реплее нет.
 * Места не проставляются: итоговый счёт игры из реплея неизвестен.
 */
async function applyReplayPrefill(prefill: ReplayPrefill): Promise<void> {
    if (playedAtInput) {
        playedAtInput.value = prefill.playedAtMs
            ? toDatetimeLocal(new Date(prefill.playedAtMs))
            : toDatetimeLocal(new Date());
    }
    if (durationInput && prefill.durationSeconds > 0) {
        durationInput.value = String(Math.max(1, Math.round(prefill.durationSeconds / 60)));
    }

    // Карта — сопоставляем по названию из реплея; если нет в базе, создаём
    if (mapSelect && prefill.mapTitle) {
        const map = await findOrCreateMapByName(prefill.mapTitle);
        if (map) mapSelect.value = String(map.id);
    }

    // Командный режим — если в реплее есть >= 2 равных команд по >= 2 игрока
    const teamIds = [...new Set(
        prefill.players
            .map((p) => p.teamId)
            .filter((id): id is number => id !== null)
    )];
    let teamMode = false;
    let teamSize = 2;
    if (teamIds.length >= 2) {
        const sizes = teamIds.map(
            (id) => prefill.players.filter((p) => p.teamId === id).length
        );
        const firstSize = sizes[0] ?? 0;
        if (firstSize >= 2 && sizes.every((s) => s === firstSize)) {
            teamMode = true;
            teamSize = firstSize;
        }
    }
    if (isTeamCheckbox) isTeamCheckbox.checked = teamMode;
    if (teamSizeSelect) teamSizeSelect.value = String(Math.min(4, Math.max(2, teamSize)));
    updateTeamModeVisibility();

    // Победитель: явный (result === 'win') либо единственный доживший до конца
    // при условии, что кто-то выбыл (last man standing). Иначе — вручную.
    const survivors = prefill.players.filter(
        (p) => !(typeof p.eliminatedOrder === 'number' && p.eliminatedOrder > 0)
    );
    const eliminatedCount = prefill.players.length - survivors.length;
    const hasExplicitWin = prefill.players.some((p) => p.result === 'win');
    const eligibleSurvivors = (!teamMode && !hasExplicitWin && eliminatedCount >= 1)
        ? survivors.filter((p) => p.result !== 'loss')
        : [];
    const soleSurvivorName = eligibleSurvivors.length === 1
        ? (eligibleSurvivors[0]?.name ?? null)
        : null;

    drafts = prefill.players.map((p) => {
        const matched = matchCachedPlayer(p.name);
        const cleanName = p.name ? stripClanTag(p.name) : null;
        const isWinner =
            p.result === 'win' || (soleSurvivorName !== null && p.name === soleSurvivorName);
        return {
            player_id: matched?.id ?? null,
            race: normalizeReplayRace(p.race),
            team: teamMode && p.teamId !== null ? p.teamId : null,
            is_winner: isWinner,
            // Итоговый счёт из реплея неизвестен — места не проставляем,
            // их нужно указать вручную (победитель получит 1-е место).
            place: null,
            raw_name: cleanName ?? p.name ?? null,
            from_replay: true,
        };
    });
}

async function openReplayGameModal(file: File): Promise<void> {
    if (file.size > 25 * 1024 * 1024) {
        alert(t('games.replay_too_large'));
        return;
    }

    const btn = document.getElementById('btn-add-from-replay') as HTMLButtonElement | null;
    const originalText = btn?.textContent ?? '';
    if (btn) {
        btn.disabled = true;
        btn.textContent = t('games.replay_parsing');
    }

    try {
        const res = await apiUpload<{ replay: ReplayPrefill }>(
            '/api/games/parse-replay',
            file,
            file.name,
            state.token,
            abortController?.signal
        );
        await openCreateGameModal(res.replay);
        alert(t('games.replay_prefilled'));
    } catch (err) {
        alert(t('games.replay_parse_error') + (err instanceof Error ? err.message : String(err)));
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = originalText;
            applyTranslationsToButton(btn);
        }
    }
}

/** Возвращает кнопке перевод после временного текста «Разбор реплея…». */
function applyTranslationsToButton(btn: HTMLButtonElement): void {
    if (btn.dataset.i18n === 'games.from_replay') btn.textContent = t('games.from_replay');
}

async function openCreateGameModal(prefill?: ReplayPrefill, fromGame?: GameFull): Promise<void> {
    if (!modal) return;
    editingGameId = null;
    isDirty = false;
    if (modalTitle) modalTitle.textContent = t('games.form_title');

    await refreshPlayersCache();
    await ensureAllRefsLoaded();

    fillSelect(formatSelect, cachedFormats, t('games.select_placeholder'));
    fillSelect(hostSelect, cachedHosts, t('games.select_placeholder'));
    fillSelect(mapSelect, cachedMaps, t('games.select_placeholder'));
    fillSelect(modSelect, cachedMods, t('games.select_placeholder'));

    const useLastCheckbox = document.getElementById('field-use-last') as HTMLInputElement | null;
    const useLast = !prefill && !fromGame && (useLastCheckbox?.checked ?? true);
    const lastGame = useLast ? loadLastGameSettings() : null;

    if (lastGame) {
        if (formatSelect && lastGame.format_id && cachedFormats.some((f) => f.id === lastGame.format_id)) {
            formatSelect.value = String(lastGame.format_id);
        }
        if (hostSelect && lastGame.host_id && cachedHosts.some((h) => h.id === lastGame.host_id)) {
            hostSelect.value = String(lastGame.host_id);
        }
        if (mapSelect && lastGame.map_id && cachedMaps.some((m) => m.id === lastGame.map_id)) {
            mapSelect.value = String(lastGame.map_id);
        }
        if (modSelect && lastGame.mod_id && cachedMods.some((m) => m.id === lastGame.mod_id)) {
            modSelect.value = String(lastGame.mod_id);
        }
        if (durationInput) durationInput.value = lastGame.duration_min ? String(lastGame.duration_min) : '';
        if (isTeamCheckbox) isTeamCheckbox.checked = lastGame.is_team;
        if (teamSizeSelect) teamSizeSelect.value = String(lastGame.team_size ?? 2);
        updateTeamModeVisibility();

        if (playedAtInput) {
            if (lastGame.played_at) {
                playedAtInput.value = lastGame.played_at;
            } else {
                playedAtInput.value = toDatetimeLocal(new Date());
            }
        }

        drafts = lastGame.players.map((p) => ({
            player_id: p.player_id,
            race: p.race,
            team: p.team,
            is_winner: false,
            place: null,
        }));
    } else {
        if (playedAtInput) playedAtInput.value = toDatetimeLocal(new Date());
        if (durationInput) durationInput.value = '';
        if (isTeamCheckbox) isTeamCheckbox.checked = false;
        if (teamSizeSelect) teamSizeSelect.value = '2';
        updateTeamModeVisibility();
        if (formatSelect) {
            const fanFfa = cachedFormats.find((f) => f.slug === 'fan-ffa');
            if (fanFfa) formatSelect.value = String(fanFfa.id);
        }
        drafts = [];
        for (let i = 0; i < 4; i++) {
            drafts.push({ player_id: null, race: 'T', team: null, is_winner: false, place: null });
        }
        if (isTeamMode()) redistributeTeams();
    }

    if (notesInput) notesInput.value = '';

    if (prefill) await applyReplayPrefill(prefill);
    else if (fromGame) applyGameSettingsFromGame(fromGame);

    normalizePlaces();
    renderPlayerDrafts();
    modal.classList.remove('hidden');
}

/**
 * Переносит настройки существующей игры в форму новой:
 * формат/ведущий/карту/мод/длительность и состав участников (раса, команда).
 * Победитель и места НЕ переносятся — их нужно проставить заново.
 */
function applyGameSettingsFromGame(gameFull: GameFull): void {
    if (formatSelect && gameFull.format && cachedFormats.some((f) => f.id === gameFull.format!.id)) {
        formatSelect.value = String(gameFull.format.id);
    }
    if (hostSelect && gameFull.host && cachedHosts.some((h) => h.id === gameFull.host!.id)) {
        hostSelect.value = String(gameFull.host.id);
    }
    if (mapSelect && gameFull.map && cachedMaps.some((m) => m.id === gameFull.map!.id)) {
        mapSelect.value = String(gameFull.map.id);
    }
    if (modSelect && gameFull.mod && cachedMods.some((m) => m.id === gameFull.mod!.id)) {
        modSelect.value = String(gameFull.mod.id);
    }

    if (durationInput) {
        durationInput.value = gameFull.duration_min ? String(gameFull.duration_min) : '';
    }

    const hasTeams = gameFull.players.some((p) => p.team !== null);
    if (isTeamCheckbox) isTeamCheckbox.checked = hasTeams;
    if (hasTeams && teamSizeSelect) {
        const firstTeam = gameFull.players[0]?.team ?? 1;
        const size = gameFull.players.filter((p) => p.team === firstTeam).length;
        teamSizeSelect.value = String(size);
    }
    updateTeamModeVisibility();

    drafts = gameFull.players.map((p) => ({
        player_id: p.player_id,
        race: p.race,
        team: p.team,
        is_winner: false,
        place: null,
    }));
}

/** Открывает форму новой игры с настройками указанной игры. */
async function openCreateFromGame(gameId: number): Promise<void> {
    try {
        const res = await apiRequest<{ game: GameFull }>(`/api/games/${gameId}`);
        await openCreateGameModal(undefined, res.game);
    } catch (err) {
        alert(t('games.load_one_error') + (err instanceof Error ? err.message : String(err)));
    }
}

async function openEditGameModal(gameId: number): Promise<void> {
    if (!modal) return;

    let gameFull: GameFull;
    try {
        const res = await apiRequest<{ game: GameFull }>(`/api/games/${gameId}`);
        gameFull = res.game;
    } catch (err) {
        alert(t('games.load_one_error') + (err instanceof Error ? err.message : String(err)));
        return;
    }

    await refreshPlayersCache();
    await ensureAllRefsLoaded();

    if (modalTitle) modalTitle.textContent = t('games.form_title_edit');

    fillSelect(formatSelect, cachedFormats, t('games.select_placeholder'));
    fillSelect(hostSelect, cachedHosts, t('games.select_placeholder'));
    fillSelect(mapSelect, cachedMaps, t('games.select_placeholder'));
    fillSelect(modSelect, cachedMods, t('games.select_placeholder'));

    if (formatSelect && gameFull.format) formatSelect.value = String(gameFull.format.id);
    if (hostSelect && gameFull.host) hostSelect.value = String(gameFull.host.id);
    if (mapSelect && gameFull.map) mapSelect.value = String(gameFull.map.id);
    if (modSelect && gameFull.mod) modSelect.value = String(gameFull.mod.id);

    if (playedAtInput) playedAtInput.value = toDatetimeLocal(new Date(gameFull.played_at));
    if (durationInput) durationInput.value = gameFull.duration_min ? String(gameFull.duration_min) : '';
    if (notesInput) notesInput.value = gameFull.notes ?? '';

    // Определяем командный режим
    const hasTeams = gameFull.players.some((p) => p.team !== null);
    if (isTeamCheckbox) isTeamCheckbox.checked = hasTeams;
    if (hasTeams && teamSizeSelect) {
        const firstTeam = gameFull.players[0]?.team ?? 1;
        const size = gameFull.players.filter((p) => p.team === firstTeam).length;
        teamSizeSelect.value = String(size);
    }
    updateTeamModeVisibility();

    // Преобразуем сохранённый порядок выбывания в места.
    const totalPlayers = gameFull.players.length;
    const teamNums = new Set(gameFull.players.map((p) => p.team ?? 0));
    const scale = hasTeams ? teamNums.size : totalPlayers;

    drafts = gameFull.players.map((p) => ({
        player_id: p.player_id,
        race: p.race,
        team: p.team,
        is_winner: p.is_winner,
        place: p.is_winner
            ? 1
            : (p.eliminated_at !== null ? scale - p.eliminated_at + 1 : null),
    }));

    normalizePlaces();
    renderPlayerDrafts();
    editingGameId = gameId;
    isDirty = false;
    modal.classList.remove('hidden');
}

function closeGameModal(force = false): void {
    if (!force && !confirmClose()) return;
    modal?.classList.add('hidden');
    form?.reset();
    drafts = [];
    editingGameId = null;
    isDirty = false;
}

// ============================================================
// Отправка формы
// ============================================================
async function submitGameForm(e: Event): Promise<void> {
    e.preventDefault();
    if (!form) return;

    if (!playedAtInput?.value) { alert(t('games.error_no_date')); return; }
    if (!formatSelect || !hostSelect || !mapSelect || !modSelect) return;
    if (!formatSelect.value || !hostSelect.value || !mapSelect.value || !modSelect.value) {
        alert(t('games.error_no_refs')); return;
    }

    const unresolved = drafts.filter((d) => d.from_replay && !d.player_id && d.raw_name);
    if (unresolved.length > 0) {
        alert(t('games.replay_unresolved', { names: unresolved.map((d) => d.raw_name).join(', ') }));
        return;
    }

    const filledPlayers = drafts.filter((d) => d.player_id !== null);
    if (filledPlayers.length === 0) { alert(t('games.error_no_players')); return; }

    const ids = filledPlayers.map((d) => d.player_id!);
    if (new Set(ids).size !== ids.length) { alert(t('games.error_duplicate_player')); return; }

    const hasWinner = filledPlayers.some((d) => d.is_winner);
    if (!hasWinner) { alert(t('games.error_no_winner')); return; }

    const teamMode = isTeamMode();

    if (teamMode) {
        const teamSize = Number(teamSizeSelect?.value ?? '2');
        if (filledPlayers.length % teamSize !== 0) {
            alert(t('games.error_team_size_mismatch', { size: teamSize })); return;
        }
        const teamsMap = new Map<number, typeof filledPlayers>();
        for (const p of filledPlayers) {
            const tNum = p.team ?? 0;
            const arr = teamsMap.get(tNum) ?? [];
            arr.push(p);
            teamsMap.set(tNum, arr);
        }
        if (teamsMap.size < 2) { alert(t('games.error_need_two_teams')); return; }
        const sizes = [...teamsMap.values()].map((arr) => arr.length);
        if (new Set(sizes).size !== 1 || sizes[0] !== teamSize) {
            alert(t('games.error_teams_uneven', { size: teamSize })); return;
        }
        const winnerTeams: number[] = [];
        for (const [tNum, players] of teamsMap) {
            if (players.every((p) => p.is_winner)) winnerTeams.push(tNum);
            else if (players.some((p) => p.is_winner)) {
                alert(t('games.error_incomplete_winner_team')); return;
            }
        }
        if (winnerTeams.length !== 1) { alert(t('games.error_multiple_winner_teams')); return; }

        // Места команд: у всех, кроме победителя, должны быть уникальные места.
        const nonWinnerPlaces: number[] = [];
        for (const [, players] of teamsMap) {
            if (players.some((p) => p.is_winner)) continue;
            const place = players.find((p) => p.place !== null && p.place > 1)?.place ?? null;
            if (place === null) { alert(t('games.error_missing_places')); return; }
            nonWinnerPlaces.push(place);
        }
        if (new Set(nonWinnerPlaces).size !== nonWinnerPlaces.length) {
            alert(t('games.error_duplicate_place')); return;
        }
    } else {
        // Места: у всех, кроме победителя, должны быть уникальные места 2..N.
        const nonWinners = filledPlayers.filter((d) => !d.is_winner);
        if (nonWinners.some((d) => d.place === null || d.place <= 1)) {
            alert(t('games.error_missing_places')); return;
        }
        const places = nonWinners.map((d) => d.place!);
        if (new Set(places).size !== places.length) {
            alert(t('games.error_duplicate_place')); return;
        }
    }

    // Место хранится в БД как порядок выбывания (обратное преобразование).
    const scale = teamMode
        ? new Set(filledPlayers.map((d) => d.team ?? 0)).size
        : filledPlayers.length;

    const playersPayload = filledPlayers.map((d) => ({
        player_id: d.player_id,
        race: d.race,
        team: d.team,
        is_winner: d.is_winner,
        eliminated_at: d.is_winner ? null : placeToElim(d.place, scale),
    }));

    const playedAtDate = new Date(playedAtInput.value);
    const payload = {
        played_at: playedAtDate.toISOString(),
        format_id: Number(formatSelect.value),
        host_id: Number(hostSelect.value),
        map_id: Number(mapSelect.value),
        mod_id: Number(modSelect.value),
        duration_min: durationInput?.value ? Number(durationInput.value) : null,
        notes: notesInput?.value?.trim() || null,
        track_elim: true,
        players: playersPayload,
    };

    const saveBtn = document.getElementById('btn-save-game') as HTMLButtonElement | null;
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = t('common.saving'); }

    try {
        if (editingGameId !== null) {
            await apiRequest(`/api/games/${editingGameId}`, { method: 'PATCH', token: state.token, body: payload });
        } else {
            await apiRequest('/api/games', { method: 'POST', token: state.token, body: payload });
        }
        saveLastGameSettings();
        closeGameModal(true);
        await loadGames();
    } catch (err) {
        alert(t('games.save_error') + (err instanceof Error ? err.message : String(err)));
    } finally {
        if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = t('common.save'); }
    }
}

// ============================================================
// Удаление игры
// ============================================================
async function deleteGame(g: GameListItem): Promise<void> {
    const confirmed = confirm(
        t('games.delete_confirm', {
            date: new Date(g.played_at).toLocaleDateString(),
            winners: g.winners.join(', '),
        })
    );
    if (!confirmed) return;
    try {
        await apiRequest(`/api/games/${g.id}`, { method: 'DELETE', token: state.token });
        await loadGames();
    } catch (err) {
        alert(t('games.delete_error') + (err instanceof Error ? err.message : String(err)));
    }
}