import { apiRequest } from '../api';
import { state } from '../state';
import { t, getLocale, onLocaleChange } from '../i18n';
import {
    createRef,
    listRefs,
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
interface FiltersState {
    formatId: number | null;
    hostId: number | null;
    mapId: number | null;
}

const filters: FiltersState = {
    formatId: null,
    hostId: null,
    mapId: null,
};


let abortController: AbortController | null = null;
let cachedGames: GameListItem[] = [];
let searchQuery = '';

let cachedPlayers: PlayerWithStats[] = [];
let cachedFormats: GameFormat[] = [];
let cachedHosts: GameHost[] = [];
let cachedMaps: GameMap[] = [];
let cachedMods: GameMod[] = [];



// ============================================================
// Форма
// ============================================================
interface GamePlayerDraft {
    player_id: number | null;
    race: 'T' | 'Z' | 'P' | 'R';
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

// ============================================================
// Mount / unmount
// ============================================================
export function mountGames(params: URLSearchParams): void {
    const screen = document.getElementById('screen-games');
    if (screen) screen.classList.remove('hidden');

    abortController = new AbortController();
    const { signal } = abortController;

    // Кэшируем DOM-элементы
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
    document.getElementById('btn-add-map')?.addEventListener('click', () => {
        void createMapInline();
    }, { signal });

    document.getElementById('btn-add-mod')?.addEventListener('click', () => {
        void createModInline();
    }, { signal });

    // Кнопка создания
    const createBtn = document.getElementById('btn-create-game');
    if (createBtn && (state.user?.is_moderator || state.user?.is_admin)) {
        createBtn.removeAttribute('hidden');
        createBtn.addEventListener('click', () => {
            void openCreateGameModal();
        }, { signal });
    } else if (createBtn) {
        createBtn.setAttribute('hidden', '');
    }

    // Поиск
    const searchInput = document.getElementById('games-search') as HTMLInputElement | null;
    searchInput?.addEventListener('input', () => {
        searchQuery = searchInput.value.trim().toLowerCase();
        renderGames();
    }, { signal });

    // Модалка
    document.getElementById('game-modal-close')?.addEventListener('click', () => closeGameModal(), { signal });
    document.getElementById('btn-cancel-game')?.addEventListener('click', () => closeGameModal(), { signal });
    form?.addEventListener('submit', (e) => void submitGameForm(e), { signal });
    document.getElementById('btn-add-player')?.addEventListener('click', () => {
        drafts.push({ player_id: null, race: 'T', is_winner: false, eliminated_at: null });
        normalizeEliminatedAt();
        renderPlayerDrafts();
        markDirty();
    }, { signal });

    // Клавиатура: Escape
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal && !modal.classList.contains('hidden')) {
            closeGameModal();
        }
    }, { signal });

    // Locale change
    onLocaleChange(() => {
        renderGames();
        if (modal && !modal.classList.contains('hidden')) {
            renderPlayerDrafts();
        }
    });

    // Читаем фильтры из URL
    const urlFormat = params.get('format');
    const urlHost = params.get('host');
    const urlMap = params.get('map');
    filters.formatId = urlFormat ? Number(urlFormat) : null;
    filters.hostId = urlHost ? Number(urlHost) : null;
    filters.mapId = urlMap ? Number(urlMap) : null;

    // Загружаем справочники для селектов
    void setupFilterSelects();

    // Обработчики селектов
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

    void loadGames().then(() => {
        const highlightId = params.get('highlight');
        if (highlightId) highlightGame(Number(highlightId));
    });
}

export function unmountGames(): void {
    abortController?.abort();
    abortController = null;
}

// ============================================================
// Загрузка списка игр
// ============================================================
async function loadGames(playerId?: string | null): Promise<void> {
    const container = document.getElementById('games-list-container');
    const errorBox = document.getElementById('games-error');
    if (!container) return;

    container.innerHTML = '<div class="skeleton skeleton-block"></div>';
    errorBox?.classList.add('hidden');

    try {
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

function renderGames(): void {
    const container = document.getElementById('games-list-container');
    if (!container) return;

    let filtered = cachedGames;

    if (filters.formatId !== null) {
        filtered = filtered.filter((g) => g.format_id === filters.formatId);
    }
    if (filters.hostId !== null) {
        filtered = filtered.filter((g) => g.host_id === filters.hostId);
    }
    if (filters.mapId !== null) {
        filtered = filtered.filter((g) => g.map_id === filters.mapId);
    }

    // Фильтр по поиску
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

function hasActiveFilters(): boolean {
    return filters.formatId !== null || filters.hostId !== null || filters.mapId !== null;
}

function buildGameCard(g: GameListItem): HTMLElement {
    const card = document.createElement('div');
    card.className = 'game-card';
    card.dataset.gameId = String(g.id);

    // --- Шапка: дата + длительность справа ---
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
    if (g.format_name && g.format_id) {
        const format = document.createElement('span');
        format.className = 'game-format-badge';
        format.textContent = g.format_name;
        format.title = t('games.click_to_filter');
        format.addEventListener('click', (e) => {
            e.stopPropagation();
            setFilter('format', g.format_id!);
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

    // --- Мета: карта · мод · хост ---
    const meta = document.createElement('div');
    meta.className = 'game-card-meta';

    if (g.map_name && g.map_id) {
        const mapEl = document.createElement('span');
        mapEl.className = 'game-clickable';
        mapEl.textContent = g.map_name;
        mapEl.title = t('games.click_to_filter');
        mapEl.addEventListener('click', (e) => {
            e.stopPropagation();
            setFilter('map', g.map_id!);
        });
        meta.appendChild(mapEl);
    }

    if (g.mod_name) {
        if (meta.childNodes.length > 0) meta.appendChild(document.createTextNode(' · '));
        meta.appendChild(document.createTextNode(g.mod_name));
    }

    if (g.host_name && g.host_id) {
        if (meta.childNodes.length > 0) meta.appendChild(document.createTextNode(' · '));
        const hostLabel = document.createTextNode(`${t('games.host_label')}: `);
        meta.appendChild(hostLabel);

        const hostEl = document.createElement('span');
        hostEl.className = 'game-clickable';
        hostEl.textContent = g.host_name;
        hostEl.title = t('games.click_to_filter');
        hostEl.addEventListener('click', (e) => {
            e.stopPropagation();
            setFilter('host', g.host_id!);
        });
        meta.appendChild(hostEl);
    }

    card.appendChild(meta);

    // --- Участники ---
    const players = document.createElement('div');
    players.className = 'game-card-players';

    // Сортируем участников: победитель сверху, потом по месту
    const sorted = [...g.participants].sort((a, b) => {
        const placeA = getPlayerPlace(a, g.participants.length);
        const placeB = getPlayerPlace(b, g.participants.length);
        return placeA - placeB;
    });

    sorted.forEach((p, index) => {
        if (index > 0) {
            const sep = document.createElement('span');
            sep.className = 'game-player-sep';
            sep.textContent = '·';
            players.appendChild(sep);
        }

        const playerEl = document.createElement('span');
        playerEl.className = 'game-player';
        if (p.is_winner) playerEl.classList.add('is-winner');
        playerEl.style.setProperty('--race-color', getRaceColor(p.race));

        const place = getPlayerPlace(p, g.participants.length);

        const medal = document.createElement('span');
        medal.className = 'game-player-medal';
        medal.textContent = place === 1 ? '🥇' : place === 2 ? '🥈' : place === 3 ? '🥉' : `#${place}`;

        const race = document.createElement('span');
        race.className = 'game-player-race';
        race.textContent = p.race;

        const name = document.createElement('span');
        name.className = 'game-player-name';
        name.textContent = p.player_name;
        if (p.player_aka) name.title = `aka ${p.player_aka}`;

        playerEl.append(medal, race, name);

        players.appendChild(playerEl);
    });

    card.appendChild(players);

    // --- Действия (для модераторов) ---
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

/**
 * Вычисляет место игрока (1-е — победитель, остальные — из eliminated_at).
 */
function getPlayerPlace(
    player: { is_winner: boolean; eliminated_at: number | null },
    totalPlayers: number
): number {
    if (player.is_winner) return 1;
    if (player.eliminated_at === null) return 1; // fallback
    return totalPlayers - player.eliminated_at + 1;
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
// Форма: справочники и игроки
// ============================================================
async function loadAllRefs(): Promise<void> {
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
}

async function loadPlayersIfNeeded(): Promise<void> {
    if (cachedPlayers.length > 0) return;
    try {
        const res = await apiRequest<PlayersListResponse>('/api/players');
        cachedPlayers = res.players;
    } catch (err) {
        console.error('[games] failed to load players:', err);
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

function markDirty(): void { isDirty = true; }

function confirmClose(): boolean {
    if (!isDirty) return true;
    return confirm(t('games.confirm_close'));
}

// ============================================================
// Открытие модалки: создание
// ============================================================
async function openCreateGameModal(): Promise<void> {
    if (!modal) return;
    editingGameId = null;
    isDirty = false;
    if (modalTitle) modalTitle.textContent = t('games.form_title');

    await loadPlayersIfNeeded();
    if (cachedFormats.length === 0) await loadAllRefs();

    fillSelect(formatSelect, cachedFormats, t('games.select_placeholder'));
    fillSelect(hostSelect, cachedHosts, t('games.select_placeholder'));
    fillSelect(mapSelect, cachedMaps, t('games.select_placeholder'));
    fillSelect(modSelect, cachedMods, t('games.select_placeholder'));

    if (playedAtInput) playedAtInput.value = toDatetimeLocal(new Date());
    if (durationInput) durationInput.value = '';
    if (notesInput) notesInput.value = '';

    if (formatSelect) {
        const fanFfa = cachedFormats.find((f) => f.slug === 'fan-ffa');
        if (fanFfa) formatSelect.value = String(fanFfa.id);
    }

    drafts = [];
    for (let i = 0; i < 4; i++) {
        drafts.push({ player_id: null, race: 'T', is_winner: false, eliminated_at: null });
    }
    normalizeEliminatedAt();
    renderPlayerDrafts();

    modal.classList.remove('hidden');
}

// ============================================================
// Открытие модалки: редактирование
// ============================================================
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

    await loadPlayersIfNeeded();
    if (cachedFormats.length === 0) await loadAllRefs();

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

    drafts = gameFull.players.map((p) => ({
        player_id: p.player_id,
        race: p.race,
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
            .filter((p) => {
                const nameMatch = p.name.toLowerCase().includes(q);
                const akaMatch = (p.aka ?? '').toLowerCase().includes(q);
                return nameMatch || akaMatch;
            })
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

function renderPlayerDrafts(): void {
    if (!playersListBox) return;
    playersListBox.innerHTML = '';

    const totalPlayers = drafts.length;

    drafts.forEach((draft, index) => {
        const row = document.createElement('div');
        row.className = 'player-entry';
        if (draft.is_winner) row.classList.add('is-winner');

        const raceSelect = document.createElement('select');
        raceSelect.className = 'race-select';

        const { wrapper: autocompleteWrap } = createPlayerAutocomplete(
            draft,
            () => markDirty(),
            (player) => {
                if (player.dominant_race) {
                    draft.race = player.dominant_race;
                    raceSelect.value = player.dominant_race;
                }
            }
        );

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

        const winnerWrap = document.createElement('label');
        winnerWrap.className = 'winner-checkbox';
        const winnerCheck = document.createElement('input');
        winnerCheck.type = 'checkbox';
        winnerCheck.checked = draft.is_winner;
        winnerCheck.addEventListener('change', () => {
            draft.is_winner = winnerCheck.checked;
            if (winnerCheck.checked) draft.eliminated_at = null;
            normalizeEliminatedAt();
            renderPlayerDrafts();
            markDirty();
        });
        winnerWrap.appendChild(winnerCheck);
        const winnerText = document.createElement('span');
        winnerText.textContent = t('games.winner_label');
        winnerWrap.appendChild(winnerText);

        const placeSelect = document.createElement('select');
        placeSelect.className = 'place-select';

        if (draft.is_winner) {
            placeSelect.style.visibility = 'hidden';
            placeSelect.disabled = true;
        } else {
            for (let place = 2; place <= totalPlayers; place++) {
                const opt = document.createElement('option');
                opt.value = String(place);
                const medal = place === 2 ? '🥈 ' : place === 3 ? '🥉 ' : '';
                opt.textContent = `${medal}${place}${getPlaceSuffix(place)}`;
                const expectedElim = totalPlayers - place + 1;
                if (draft.eliminated_at === expectedElim) opt.selected = true;
                placeSelect.appendChild(opt);
            }

            if (draft.eliminated_at === null) {
                draft.eliminated_at = totalPlayers - 2 + 1;
                placeSelect.value = '2';
            }

            placeSelect.addEventListener('change', () => {
                const place = Number(placeSelect.value);
                draft.eliminated_at = totalPlayers - place + 1;
                markDirty();
            });
        }

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'remove-player';
        removeBtn.textContent = '✕';
        removeBtn.title = t('games.remove_player');
        removeBtn.addEventListener('click', () => {
            drafts.splice(index, 1);
            normalizeEliminatedAt();
            renderPlayerDrafts();
            markDirty();
        });

        row.append(autocompleteWrap, raceSelect, winnerWrap, placeSelect, removeBtn);
        playersListBox!.appendChild(row);
    });
}

function normalizeEliminatedAt(): void {
    const total = drafts.length;
    const winners = drafts.filter((d) => d.is_winner);
    const nonWinners = drafts.filter((d) => !d.is_winner);

    for (const w of winners) w.eliminated_at = null;

    const used = new Set<number>();
    for (const p of nonWinners) {
        if (p.eliminated_at !== null && p.eliminated_at <= total - 1 && !used.has(p.eliminated_at)) {
            used.add(p.eliminated_at);
        } else {
            p.eliminated_at = null;
        }
    }

    const free: number[] = [];
    for (let i = 1; i <= total - 1; i++) {
        if (!used.has(i)) free.push(i);
    }
    for (const p of nonWinners) {
        if (p.eliminated_at === null) {
            p.eliminated_at = free.shift() ?? null;
        }
    }
}

// ============================================================
// Сохранение игры
// ============================================================
async function submitGameForm(e: Event): Promise<void> {
    e.preventDefault();
    if (!form) return;

    normalizeEliminatedAt();

    if (!playedAtInput?.value) { alert(t('games.error_no_date')); return; }
    if (!formatSelect?.value || !hostSelect?.value || !mapSelect?.value || !modSelect?.value) {
        alert(t('games.error_no_refs')); return;
    }

    const filledPlayers = drafts.filter((d) => d.player_id !== null);
    if (filledPlayers.length === 0) { alert(t('games.error_no_players')); return; }

    const ids = filledPlayers.map((d) => d.player_id!);
    const uniqueIds = new Set(ids);
    if (uniqueIds.size !== ids.length) { alert(t('games.error_duplicate_player')); return; }

    const hasWinner = filledPlayers.some((d) => d.is_winner);
    if (!hasWinner) { alert(t('games.error_no_winner')); return; }

    const nonWinners = filledPlayers.filter((d) => !d.is_winner);
    const eliminations = nonWinners.map((d) => d.eliminated_at);
    const uniqueEliminations = new Set(eliminations.filter((x) => x !== null));
    if (uniqueEliminations.size !== eliminations.length) {
        alert(t('games.error_duplicate_place')); return;
    }
    if (uniqueEliminations.size !== filledPlayers.length - 1) {
        alert(t('games.error_missing_places')); return;
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
            await apiRequest(`/api/games/${editingGameId}`, {
                method: 'PATCH', token: state.token, body: payload,
            });
        } else {
            await apiRequest('/api/games', {
                method: 'POST', token: state.token, body: payload,
            });
        }
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
        await apiRequest(`/api/games/${g.id}`, {
            method: 'DELETE', token: state.token,
        });
        await loadGames();
    } catch (err) {
        alert(t('games.delete_error') + (err instanceof Error ? err.message : String(err)));
    }
}

/**
 * Заполняет селекты справочниками.
 */
async function setupFilterSelects(): Promise<void> {
    try {
        if (cachedFormats.length === 0) {
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

        // Устанавливаем текущие значения
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

function fillFilterSelect(
    selectId: string,
    items: { id: number; name: string }[]
): void {
    const select = document.getElementById(selectId) as HTMLSelectElement | null;
    if (!select) return;

    const currentValue = select.value;

    // Оставляем первый option «Все»
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

/**
 * Применяет текущие фильтры: перерисовывает список + URL + чипы.
 */
function applyFilters(): void {
    updateUrlFromFilters();
    renderGames();
    renderActiveFilterChips();
}

/**
 * Сбрасывает все фильтры.
 */
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

/**
 * Обновляет URL с учётом фильтров.
 */
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

/**
 * Рендерит чипы активных фильтров.
 */
function renderActiveFilterChips(): void {
    const container = document.getElementById('games-active-filters');
    const resetBtn = document.getElementById('btn-reset-filters');
    if (!container) return;

    container.innerHTML = '';

    const chips: { label: string; value: string; onRemove: () => void }[] = [];

    if (filters.formatId !== null) {
        const f = cachedFormats.find((x) => x.id === filters.formatId);
        if (f) {
            chips.push({
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
    }

    if (filters.hostId !== null) {
        const h = cachedHosts.find((x) => x.id === filters.hostId);
        if (h) {
            chips.push({
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
    }

    if (filters.mapId !== null) {
        const m = cachedMaps.find((x) => x.id === filters.mapId);
        if (m) {
            chips.push({
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
    }

    // Показываем/скрываем кнопку сброса
    if (resetBtn) {
        resetBtn.hidden = chips.length === 0;
    }

    // Рендерим чипы
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

function setFilter(type: 'format' | 'host' | 'map', id: number): void {
    if (type === 'format') filters.formatId = id;
    if (type === 'host') filters.hostId = id;
    if (type === 'map') filters.mapId = id;

    // Синхронизируем селект
    const selectId = type === 'format' ? 'filter-format' : type === 'host' ? 'filter-host' : 'filter-map';
    const sel = document.getElementById(selectId) as HTMLSelectElement | null;
    if (sel) sel.value = String(id);

    applyFilters();
}

/**
 * Создаёт новую карту через prompt и обновляет селект.
 */
async function createMapInline(): Promise<void> {
  const name = prompt(t('games.new_map_prompt'));
  if (name === null) return;

  const trimmed = name.trim();
  if (!trimmed) return;

  try {
    const newMap = await createRef<GameMap>(
      'maps',
      { name: trimmed },
      state.token
    );

    // Обновляем кэш
    cachedMaps = [...cachedMaps, newMap];
    cachedMaps.sort((a, b) => a.name.localeCompare(b.name));

    // Перестраиваем селект
    fillSelect(mapSelect, cachedMaps, t('games.select_placeholder'));
    if (mapSelect) mapSelect.value = String(newMap.id);

    markDirty();
  } catch (err) {
    alert(t('games.new_map_error') + (err instanceof Error ? err.message : String(err)));
  }
}

/**
 * Создаёт новый мод через prompt и обновляет селект.
 */
async function createModInline(): Promise<void> {
  const name = prompt(t('games.new_mod_prompt'));
  if (name === null) return;

  const trimmed = name.trim();
  if (!trimmed) return;

  try {
    const newMod = await createRef<GameMod>(
      'mods',
      { name: trimmed },
      state.token
    );

    cachedMods = [...cachedMods, newMod];
    cachedMods.sort((a, b) => a.name.localeCompare(b.name));

    fillSelect(modSelect, cachedMods, t('games.select_placeholder'));
    if (modSelect) modSelect.value = String(newMod.id);

    markDirty();
  } catch (err) {
    alert(t('games.new_mod_error') + (err instanceof Error ? err.message : String(err)));
  }
}