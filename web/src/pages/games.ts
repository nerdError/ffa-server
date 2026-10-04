import { apiRequest } from '../api';
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
};

// ============================================================
// Форма
// ============================================================
interface GamePlayerDraft {
    player_id: number | null;
    race: 'T' | 'Z' | 'P' | 'R';
    team: number | null;
    is_winner: boolean;
    eliminated_at: number | null;
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
let trackElimCheckbox: HTMLInputElement | null = null;

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
    trackElimCheckbox = document.getElementById('field-track-elim') as HTMLInputElement | null;

    filters.formatId = params.get('format') ? Number(params.get('format')) : null;
    filters.hostId = params.get('host') ? Number(params.get('host')) : null;
    filters.mapId = params.get('map') ? Number(params.get('map')) : null;

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

    trackElimCheckbox?.addEventListener('change', () => {
        normalizeEliminatedAt();
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
        const urlParams = new URLSearchParams(window.location.search);
        const playerId = urlParams.get('player_id');
        const url = playerId
            ? `/api/games?player_id=${encodeURIComponent(playerId)}`
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
    return filters.formatId !== null || filters.hostId !== null || filters.mapId !== null;
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

    container.innerHTML = '';
    for (const g of filtered) {
        container.appendChild(buildGameCard(g));
    }
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

    const players = document.createElement('div');
    players.className = 'game-card-players';

    if (g.is_team) {
        renderTeamPlayers(players, g);
    } else {
        renderSoloPlayers(players, g);
    }

    card.appendChild(players);

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

        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'game-action-btn game-action-btn--delete';
        delBtn.title = t('games.delete_game');
        delBtn.textContent = '🗑';
        delBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            void deleteGame(g);
        });

        actions.append(editBtn, delBtn);
        card.appendChild(actions);
    }

    return card;
}

function renderSoloPlayers(container: HTMLElement, g: GameListItem): void {
    // Сортируем:
    // 1) победители (по 1)
    // 2) не выбывшие (eliminated_at = null)
    // 3) выбывшие — от большего eliminated_at к меньшему (позже выбыл = выше)
    const sorted = [...g.participants].sort((a, b) => {
        if (a.is_winner !== b.is_winner) return a.is_winner ? -1 : 1;
        const ae = a.eliminated_at ?? Number.MAX_SAFE_INTEGER;
        const be = b.eliminated_at ?? Number.MAX_SAFE_INTEGER;
        if (ae !== be) return be - ae;
        return a.player_name.localeCompare(b.player_name);
    });

    sorted.forEach((p, index) => {
        if (index > 0) {
            const sep = document.createElement('span');
            sep.className = 'game-player-sep';
            sep.textContent = '·';
            container.appendChild(sep);
        }

        const el = document.createElement('span');
        el.className = 'game-player';
        if (p.is_winner) el.classList.add('is-winner');
        if (p.eliminated_at !== null) el.classList.add('is-eliminated');
        el.style.setProperty('--race-color', getRaceColor(p.race));

        const placeLabel = document.createElement('span');
        placeLabel.className = 'game-player-medal';
        if (p.is_winner) {
            placeLabel.textContent = '🥇';
        } else if (p.eliminated_at !== null) {
            const total = g.participants.length;
            const place = total - p.eliminated_at + 1;
            placeLabel.textContent = place === 2 ? '🥈' : place === 3 ? '🥉' : `#${place}`;
        } else {
            placeLabel.textContent = '·';
        }

        const race = document.createElement('span');
        race.className = 'game-player-race';
        race.textContent = p.race;

        const name = document.createElement('span');
        name.className = 'game-player-name';
        name.textContent = p.player_name;

        el.append(placeLabel, race, name);
        container.appendChild(el);
    });
}

function renderTeamPlayers(container: HTMLElement, g: GameListItem): void {
    const teamMap = new Map<number, typeof g.participants>();
    for (const p of g.participants) {
        const teamNum = p.team ?? 0;
        const arr = teamMap.get(teamNum) ?? [];
        arr.push(p);
        teamMap.set(teamNum, arr);
    }

    const teams: { teamNum: number; players: typeof g.participants; place: number; isWinner: boolean }[] = [];
    const totalTeams = teamMap.size;

    for (const [teamNum, players] of teamMap.entries()) {
        const isWinner = players.some((p) => p.is_winner);
        const elimAt = players.map((p) => p.eliminated_at).find((x) => x !== null) ?? null;
        let place: number;
        if (isWinner) place = 1;
        else if (elimAt === null) place = 2; // все дожили до конца
        else place = totalTeams - elimAt + 1;
        teams.push({ teamNum, players, place, isWinner });
    }

    teams.sort((a, b) => {
        if (a.place !== b.place) return a.place - b.place;
        return a.teamNum - b.teamNum;
    });

    teams.forEach((team, index) => {
        if (index > 0) {
            const sep = document.createElement('span');
            sep.className = 'game-player-sep';
            sep.textContent = '·';
            container.appendChild(sep);
        }

        const teamEl = document.createElement('span');
        teamEl.className = 'game-team';
        if (team.isWinner) teamEl.classList.add('is-winner');
        if (team.players.some((p) => p.eliminated_at !== null)) {
            teamEl.classList.add('is-eliminated');
        }

        const placeLabel = document.createElement('span');
        placeLabel.className = 'game-player-medal';
        placeLabel.textContent =
            team.place === 1 ? '🥇' :
                team.place === 2 ? '🥈' :
                    team.place === 3 ? '🥉' : `#${team.place}`;
        teamEl.appendChild(placeLabel);

        const teamLabel = document.createElement('span');
        teamLabel.className = 'game-team-label';
        teamLabel.textContent = `${t('games.team_label')} ${team.teamNum}`;
        teamEl.appendChild(teamLabel);

        const members = document.createElement('span');
        members.className = 'game-team-members';

        team.players.forEach((p, i) => {
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
    });
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
    filters.formatId = null;
    filters.hostId = null;
    filters.mapId = null;
    const formatSel = document.getElementById('filter-format') as HTMLSelectElement | null;
    const hostSel = document.getElementById('filter-host') as HTMLSelectElement | null;
    const mapSel = document.getElementById('filter-map') as HTMLSelectElement | null;
    if (formatSel) formatSel.value = '';
    if (hostSel) hostSel.value = '';
    if (mapSel) mapSel.value = '';
    applyFilters();
}

function updateUrlFromFilters(): void {
    const url = new URL(window.location.href);
    if (filters.formatId !== null) url.searchParams.set('format', String(filters.formatId));
    else url.searchParams.delete('format');
    if (filters.hostId !== null) url.searchParams.set('host', String(filters.hostId));
    else url.searchParams.delete('host');
    if (filters.mapId !== null) url.searchParams.set('map', String(filters.mapId));
    else url.searchParams.delete('map');
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

function getEliminationSuffix(elim: number): string {
    // «1-й выбыл», «2-й выбыл», ...
    if (getLocale() === 'ru') return `-й выбыл`;
    if (elim === 1) return 'st out';
    if (elim === 2) return 'nd out';
    if (elim === 3) return 'rd out';
    return 'th out';
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
    return Boolean(trackElimCheckbox?.checked);
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
        eliminated_at: null,
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
// Нормализация eliminated_at
// ============================================================
function normalizeEliminatedAt(): void {
    if (!isTrackElim()) {
        // Учёт выбывания отключён: у всех, кроме победителя, eliminated_at = null
        for (const d of drafts) {
            if (d.is_winner) d.eliminated_at = null;
            else d.eliminated_at = null;
        }
        return;
    }
    // Включён — не трогаем то, что установил пользователь
    for (const d of drafts) {
        if (d.is_winner) d.eliminated_at = null;
    }
}

// ============================================================
// Список участников в форме
// ============================================================
function renderPlayerDrafts(): void {
    if (!playersListBox) return;
    playersListBox.innerHTML = '';

    const teamMode = isTeamMode();
    const trackElim = isTrackElim();
    const totalPlayers = drafts.length;
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
            if (indices.some((i) => drafts[i]?.eliminated_at !== null)) group.classList.add('is-eliminated');
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

            // Селект выбывания для команды (только если не победители и включён учёт)
            if (trackElim && !allWinners) {
                const teamElimSelect = document.createElement('select');
                teamElimSelect.className = 'team-elim-select';

                const notOut = document.createElement('option');
                notOut.value = '';
                notOut.textContent = t('games.not_eliminated');
                teamElimSelect.appendChild(notOut);

                const N = totalPlayers;
                const teamCount = sortedTeams.length;
                const maxElim = Math.max(1, teamCount - 1);

                for (let elim = 1; elim <= maxElim; elim++) {
                    const opt = document.createElement('option');
                    opt.value = String(elim);
                    opt.textContent = `${elim}${getEliminationSuffix(elim)}`;
                    // Определяем текущее выбывание команды
                    const currentElim = indices.map((i) => drafts[i]?.eliminated_at).find((x) => x !== null);
                    if (currentElim === elim) opt.selected = true;
                    teamElimSelect.appendChild(opt);
                }

                const currentElim = indices.map((i) => drafts[i]?.eliminated_at).find((x) => x !== null);
                if (currentElim === null || currentElim === undefined) {
                    teamElimSelect.value = '';
                }

                teamElimSelect.addEventListener('change', () => {
                    const v = teamElimSelect.value;
                    const elim = v === '' ? null : Number(v);
                    for (const i of indices) {
                        const d = drafts[i];
                        if (d && !d.is_winner) {
                            d.eliminated_at = elim;
                        }
                    }
                    markDirty();
                });

                header.appendChild(teamElimSelect);
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
    const trackElim = isTrackElim();

    const row = document.createElement('div');
    row.className = 'player-entry';
    if (teamMode) row.classList.add('is-team-mode');
    if (draft.is_winner) row.classList.add('is-winner');
    if (draft.eliminated_at !== null) row.classList.add('is-eliminated');

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
        if (winnerCheck.checked) draft.eliminated_at = null;
        renderPlayerDrafts();
        markDirty();
    });
    winnerWrap.appendChild(winnerCheck);
    const winnerText = document.createElement('span');
    winnerText.textContent = t('games.winner_label');
    winnerWrap.appendChild(winnerText);

    // --- Выбывание (только для одиночного режима) ---
    let elimSelect: HTMLSelectElement | null = null;
    if (!teamMode && trackElim) {
        elimSelect = document.createElement('select');
        elimSelect.className = 'elim-select';

        const notOut = document.createElement('option');
        notOut.value = '';
        notOut.textContent = t('games.not_eliminated');
        elimSelect.appendChild(notOut);

        if (!draft.is_winner) {
            const maxElim = Math.max(1, totalPlayers - 1);
            for (let elim = 1; elim <= maxElim; elim++) {
                const opt = document.createElement('option');
                opt.value = String(elim);
                opt.textContent = `${elim}${getEliminationSuffix(elim)}`;
                if (draft.eliminated_at === elim) opt.selected = true;
                elimSelect.appendChild(opt);
            }
            if (draft.eliminated_at === null) elimSelect.value = '';

            const es = elimSelect;
            es.addEventListener('change', () => {
                const v = es.value;
                draft.eliminated_at = v === '' ? null : Number(v);
                markDirty();
            });
        } else {
            elimSelect.style.visibility = 'hidden';
            elimSelect.disabled = true;
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
    if (elimSelect) row.appendChild(elimSelect);
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
        input.value = player ? player.name : '';
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
            if (selectedPlayerId === null) input.value = '';
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
async function openCreateGameModal(): Promise<void> {
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
    const useLast = useLastCheckbox?.checked ?? true;
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
        if (trackElimCheckbox) trackElimCheckbox.checked = lastGame.track_elim ?? true;
        updateTeamModeVisibility();

        drafts = lastGame.players.map((p) => ({
            player_id: p.player_id,
            race: p.race,
            team: p.team,
            is_winner: false,
            eliminated_at: null,
        }));
    } else {
        if (playedAtInput) playedAtInput.value = toDatetimeLocal(new Date());
        if (durationInput) durationInput.value = '';
        if (isTeamCheckbox) isTeamCheckbox.checked = false;
        if (teamSizeSelect) teamSizeSelect.value = '2';
        if (trackElimCheckbox) trackElimCheckbox.checked = true;
        updateTeamModeVisibility();
        if (formatSelect) {
            const fanFfa = cachedFormats.find((f) => f.slug === 'fan-ffa');
            if (fanFfa) formatSelect.value = String(fanFfa.id);
        }
        drafts = [];
        for (let i = 0; i < 4; i++) {
            drafts.push({ player_id: null, race: 'T', team: null, is_winner: false, eliminated_at: null });
        }
        if (isTeamMode()) redistributeTeams();
    }

    if (playedAtInput) playedAtInput.value = toDatetimeLocal(new Date());
    if (notesInput) notesInput.value = '';

    normalizeEliminatedAt();
    renderPlayerDrafts();
    modal.classList.remove('hidden');
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

    // Если у кого-то есть eliminated_at — включаем учёт
    const hasElim = gameFull.players.some((p) => p.eliminated_at !== null);
    if (trackElimCheckbox) trackElimCheckbox.checked = hasElim || true;

    drafts = gameFull.players.map((p) => ({
        player_id: p.player_id,
        race: p.race,
        team: p.team,
        is_winner: p.is_winner,
        eliminated_at: p.eliminated_at,
    }));

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

    const filledPlayers = drafts.filter((d) => d.player_id !== null);
    if (filledPlayers.length === 0) { alert(t('games.error_no_players')); return; }

    const ids = filledPlayers.map((d) => d.player_id!);
    if (new Set(ids).size !== ids.length) { alert(t('games.error_duplicate_player')); return; }

    const hasWinner = filledPlayers.some((d) => d.is_winner);
    if (!hasWinner) { alert(t('games.error_no_winner')); return; }

    const teamMode = isTeamMode();
    const trackElim = isTrackElim();

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
    } else {
        if (trackElim) {
            const nonWinners = filledPlayers.filter((d) => !d.is_winner);
            const eliminations = nonWinners.map((d) => d.eliminated_at).filter((x) => x !== null);
            if (new Set(eliminations).size !== eliminations.length) {
                alert(t('games.error_duplicate_place')); return;
            }
        }
    }

    const playedAtDate = new Date(playedAtInput.value);
    const payload = {
        played_at: playedAtDate.toISOString(),
        format_id: Number(formatSelect.value),
        host_id: Number(hostSelect.value),
        map_id: Number(mapSelect.value),
        mod_id: Number(modSelect.value),
        duration_min: durationInput?.value ? Number(durationInput.value) : null,
        notes: notesInput?.value?.trim() || null,
        players: filledPlayers,
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