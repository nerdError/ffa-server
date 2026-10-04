import './styles/main.css';
import { apiRequest } from './api';
import { state } from './state';
import { t, applyTranslations, getLocale, setLocale, onLocaleChange, type Locale } from './i18n';
import { GameFull, GameListItem, GamesListResponse } from './types-games';
import { GameFormat, GameHost, GameMap, GameMod, listRefs } from './api/game-refs';
import { PlayersListResponse, PlayerWithStats } from './types';

let cachedPlayers: PlayerWithStats[] = [];

async function loadPlayersIfNeeded(): Promise<void> {
    if (cachedPlayers.length > 0) return;
    try {
        const res = await apiRequest<PlayersListResponse>('/api/players');
        cachedPlayers = res.players;
    } catch (err) {
        console.error('[games] failed to load players:', err);
    }
}

// ============================================================
// Установка языка (тот же код, что в main.ts)
// ============================================================
function setupLangSwitch(): void {
    const buttons = document.querySelectorAll<HTMLButtonElement>('.lang-btn');

    const updateActive = (locale: Locale): void => {
        buttons.forEach((btn) => {
            btn.classList.toggle('is-active', btn.dataset.lang === locale);
        });
    };

    buttons.forEach((btn) => {
        btn.addEventListener('click', () => {
            const lang = btn.dataset.lang as Locale | undefined;
            if (lang === 'ru' || lang === 'en') setLocale(lang);
        });
    });

    updateActive(getLocale());
    onLocaleChange(updateActive);
}

// ============================================================
// Рендер шапки (упрощённый — без кнопок управления ролями, но с учётом ролей)
// ============================================================
function renderUserBox(): void {
    const box = document.getElementById('user-box');
    if (!box) return;
    box.innerHTML = '';

    if (state.user) {
        // Ссылка на /control
        const controlLink = document.createElement('a');
        controlLink.href = '/control';
        controlLink.className = 'topbar-link';
        controlLink.innerHTML = `🎬 <span class="btn-label">${t('topbar.streamer_mode')}</span>`;

        // Ссылка на /admin (только админ)
        let adminLink: HTMLAnchorElement | null = null;
        if (state.user.is_admin) {
            adminLink = document.createElement('a');
            adminLink.href = '/admin';
            adminLink.className = 'topbar-link topbar-link--admin';
            adminLink.innerHTML = `⚙ <span class="btn-label">${t('topbar.admin')}</span>`;
        }

        // Ник с бейджем
        const nameWrap = document.createElement('span');
        nameWrap.className = 'topbar-username';
        nameWrap.textContent = state.user.username || state.user.email;
        if (state.user.is_admin) {
            const badge = document.createElement('span');
            badge.className = 'role-badge role-badge--admin';
            badge.textContent = `★ ${t('topbar.role_admin')}`;
            nameWrap.appendChild(badge);
        } else if (state.user.is_moderator) {
            const badge = document.createElement('span');
            badge.className = 'role-badge role-badge--moderator';
            badge.textContent = `◆ ${t('topbar.role_moderator')}`;
            nameWrap.appendChild(badge);
        }

        // Выйти
        const btn = document.createElement('button');
        btn.textContent = t('common.logout');
        btn.className = 'btn-secondary';
        btn.addEventListener('click', () => {
            void (async () => {
                try {
                    await apiRequest('/api/auth/logout', { method: 'POST', token: state.token });
                } catch { }
                localStorage.removeItem('token');
                localStorage.removeItem('refresh_token');
                localStorage.removeItem('user');
                window.location.href = '/';
            })();
        });

        box.append(controlLink);
        if (adminLink) box.append(adminLink);
        box.append(nameWrap, btn);
        return;
    }

    // Не залогинен — кнопка «Войти»
    const loginBtn = document.createElement('button');
    loginBtn.type = 'button';
    loginBtn.className = 'topbar-login-btn';
    loginBtn.textContent = t('common.login');
    loginBtn.addEventListener('click', () => {
        window.location.href = '/';
    });
    box.appendChild(loginBtn);
}

// ============================================================
// Загрузка и рендер списка игр
// ============================================================
const listContainer = document.getElementById('games-list-container');
const errorBox = document.getElementById('games-error');
const searchInput = document.getElementById('games-search') as HTMLInputElement | null;
const createBtn = document.getElementById('btn-create-game');

let cachedGames: GameListItem[] = [];
let searchQuery = '';

async function loadGames(): Promise<void> {
    if (!listContainer) return;
    listContainer.innerHTML = '<div class="skeleton skeleton-block"></div>';
    errorBox?.classList.add('hidden');

    try {
        const res = await apiRequest<GamesListResponse>('/api/games');
        cachedGames = res.games;
        renderGames();
    } catch (err) {
        if (errorBox) {
            errorBox.textContent = t('games.load_error') +
                (err instanceof Error ? err.message : String(err));
            errorBox.classList.remove('hidden');
        }
        listContainer.innerHTML = '';
    }
}

function renderGames(): void {
    if (!listContainer) return;

    const filtered = searchQuery
        ? cachedGames.filter((g) => {
            const hay = [
                ...g.winners,
                ...g.participants.map((p) => p.player_name),
                g.map_name ?? '',
                g.host_name ?? '',
            ].join(' ').toLowerCase();
            return hay.includes(searchQuery);
        })
        : cachedGames;

    if (filtered.length === 0) {
        listContainer.innerHTML = `<p class="hint">${searchQuery ? t('games.nothing_found') : t('games.no_games')
            }</p>`;
        return;
    }

    listContainer.innerHTML = '';
    for (const g of filtered) {
        listContainer.appendChild(buildGameCard(g));
    }
}

function buildGameCard(g: GameListItem): HTMLElement {
    const card = document.createElement('div');
    card.className = 'game-card';

    // --- Дата и время ---
    const header = document.createElement('div');
    header.className = 'game-card-header';

    const date = document.createElement('div');
    date.className = 'game-card-date';
    const d = new Date(g.played_at);
    date.textContent = d.toLocaleString(getLocale() === 'ru' ? 'ru-RU' : 'en-US', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });

    const duration = document.createElement('div');
    duration.className = 'game-card-duration';
    if (g.duration_min) {
        duration.textContent = `${g.duration_min} ${t('games.minutes_short')}`;
    }

    header.append(date, duration);
    card.appendChild(header);

    // --- Формат и хост ---
    const meta = document.createElement('div');
    meta.className = 'game-card-meta';

    if (g.format_name) {
        const format = document.createElement('span');
        format.className = 'game-format-badge';
        format.textContent = g.format_name;
        meta.appendChild(format);
    }

    if (g.host_name) {
        const host = document.createElement('span');
        host.className = 'game-host';
        host.innerHTML = `<span class="game-host-label">${t('games.host_label')}:</span> ${g.host_name}`;
        meta.appendChild(host);
    }

    card.appendChild(meta);

    // --- Карта и мод ---
    if (g.map_name || g.mod_name) {
        const mapMod = document.createElement('div');
        mapMod.className = 'game-card-map';
        const parts: string[] = [];
        if (g.map_name) parts.push(g.map_name);
        if (g.mod_name) parts.push(`(${g.mod_name})`);
        mapMod.textContent = parts.join(' ');
        card.appendChild(mapMod);
    }

    // --- Участники ---
    const players = document.createElement('div');
    players.className = 'game-card-players';

    for (const p of g.participants) {
        const playerEl = document.createElement('span');
        playerEl.className = 'game-player';
        if (p.is_winner) playerEl.classList.add('is-winner');
        playerEl.style.setProperty('--race-color', getRaceColor(p.race));

        const raceDot = document.createElement('span');
        raceDot.className = 'game-player-race';
        raceDot.textContent = p.race;

        const name = document.createElement('span');
        name.className = 'game-player-name';
        name.textContent = p.player_name;

        playerEl.append(raceDot, name);

        if (p.eliminated_at !== null) {
            const place = document.createElement('span');
            place.className = 'game-player-place';
            place.textContent = `#${g.participants.length - p.eliminated_at + 1}`;
            playerEl.appendChild(place);
        }

        if (p.is_winner) {
            const crown = document.createElement('span');
            crown.className = 'game-player-crown';
            crown.textContent = '👑';
            playerEl.appendChild(crown);
        }

        players.appendChild(playerEl);
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

function getRaceColor(race: string): string {
    switch (race) {
        case 'T': return 'var(--race-terran)';
        case 'Z': return 'var(--race-zerg)';
        case 'P': return 'var(--race-protoss)';
        case 'R': return 'var(--race-random)';
        default: return 'var(--text-secondary)';
    }
}

// ============================================================
// Инициализация
// ============================================================
async function init(): Promise<void> {
    setupLangSwitch();
    applyTranslations();
    document.title = t('games.title') + ' — SC2 FFA League';
    renderUserBox();

    // Показываем кнопку «Добавить игру» только модераторам и админам
    if (createBtn && (state.user?.is_moderator || state.user?.is_admin)) {
        createBtn.removeAttribute('hidden');
        createBtn.addEventListener('click', () => {
            void openCreateGameModal();
        });
    }

    // Обработка поиска
    searchInput?.addEventListener('input', () => {
        searchQuery = searchInput.value.trim().toLowerCase();
        renderGames();
    });

    // Переключение языка
    onLocaleChange(() => {
        applyTranslations();
        document.title = t('games.title') + ' — SC2 FFA League';
        renderUserBox();
        renderGames();
    });

    await loadGames();
}

// ============================================================
// Форма создания игры
// ============================================================
interface GamePlayerDraft {
    player_id: number | null;
    race: 'T' | 'Z' | 'P' | 'R';
    is_winner: boolean;
    eliminated_at: number | null;
}

const modal = document.getElementById('game-modal');
const form = document.getElementById('game-form') as HTMLFormElement | null;
const modalTitle = document.getElementById('game-modal-title');
const modalClose = document.getElementById('game-modal-close');
const cancelBtn = document.getElementById('btn-cancel-game');
const playersListBox = document.getElementById('players-list');
const addPlayerBtn = document.getElementById('btn-add-player');

const formatSelect = document.getElementById('field-format') as HTMLSelectElement | null;
const hostSelect = document.getElementById('field-host') as HTMLSelectElement | null;
const mapSelect = document.getElementById('field-map') as HTMLSelectElement | null;
const modSelect = document.getElementById('field-mod') as HTMLSelectElement | null;
const playedAtInput = document.getElementById('field-played-at') as HTMLInputElement | null;
const durationInput = document.getElementById('field-duration') as HTMLInputElement | null;
const notesInput = document.getElementById('field-notes') as HTMLTextAreaElement | null;

let drafts: GamePlayerDraft[] = [];
let editingGameId: number | null = null;
let isDirty = false;

function markDirty(): void {
    isDirty = true;
}

function confirmClose(): boolean {
    if (!isDirty) return true;
    return confirm(t('games.confirm_close'));
}

// Кэшируем справочники, чтобы не перезапрашивать каждый раз
let cachedFormats: GameFormat[] = [];
let cachedHosts: GameHost[] = [];
let cachedMaps: GameMap[] = [];
let cachedMods: GameMod[] = [];

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

/**
 * Форматирует Date в строку для input[type=datetime-local].
 * Формат: YYYY-MM-DDTHH:MM (локальное время).
 */
function toDatetimeLocal(date: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return (
        `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
        `T${pad(date.getHours())}:${pad(date.getMinutes())}`
    );
}

/**
 * Открывает модалку для создания новой игры.
 */
async function openCreateGameModal(): Promise<void> {
    if (!modal) return;

    modalTitle && (modalTitle.textContent = t('games.form_title'));

    editingGameId = null;   // ← НОВОЕ
    modalTitle && (modalTitle.textContent = t('games.form_title'));

    // Загружаем игроков и справочники (кэшируются)
    await loadPlayersIfNeeded();
    if (cachedFormats.length === 0) {
        await loadAllRefs();
    }

    // Подписка на изменения
    form?.querySelectorAll('input, select, textarea').forEach((el) => {
        el.addEventListener('input', markDirty);
        el.addEventListener('change', markDirty);
    });

    modalTitle && (modalTitle.textContent = t('games.form_title'));

    // Заполняем справочники (один раз за сессию)
    if (cachedFormats.length === 0) {
        await loadAllRefs();
    }

    fillSelect(formatSelect, cachedFormats, t('games.select_placeholder'));
    fillSelect(hostSelect, cachedHosts, t('games.select_placeholder'));
    fillSelect(mapSelect, cachedMaps, t('games.select_placeholder'));
    fillSelect(modSelect, cachedMods, t('games.select_placeholder'));

    // Устанавливаем текущую дату
    if (playedAtInput) {
        playedAtInput.value = toDatetimeLocal(new Date());
    }

    // Дефолтный формат — «Фан FFA», если есть
    if (formatSelect) {
        const fanFfa = cachedFormats.find((f) => f.slug === 'fan-ffa');
        if (fanFfa) formatSelect.value = String(fanFfa.id);
    }

    // Сбрасываем участников — добавляем 4 пустых
    drafts = [];
    for (let i = 0; i < 4; i++) {
        drafts.push({ player_id: null, race: 'T', is_winner: false, eliminated_at: null });
    }
    renderPlayerDrafts();

    modal.classList.remove('hidden');
}

function closeGameModal(force = false): void {
    if (!force && !confirmClose()) return;
    modal?.classList.add('hidden');
    form?.reset();
    drafts = [];
    editingGameId = null;   // ← НОВОЕ
    isDirty = false;
}

/**
 * Создаёт поле автокомплита для выбора игрока.
 * Возвращает контейнер и функцию для установки значения извне.
 */
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

    // Состояние
    let selectedPlayerId: number | null = draft.player_id;
    let highlightedIndex = -1;
    let matches: PlayerWithStats[] = [];

    // Установить значение извне (например, при редактировании)
    function refresh(): void {
        const player = cachedPlayers.find((p) => p.id === selectedPlayerId);
        input.value = player ? player.name : '';
    }

    // Показать список совпадений
    function showDropdown(query: string): void {
        const q = query.trim().toLowerCase();
        if (!q) {
            dropdown.classList.add('hidden');
            matches = [];
            return;
        }

        // Фильтруем по имени и aka
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
                e.preventDefault(); // чтобы не потерять фокус
                selectPlayer(p);
            });

            dropdown.appendChild(item);
        });

        dropdown.classList.remove('hidden');
    }

    // Выбрать игрока
    function selectPlayer(p: PlayerWithStats): void {
        selectedPlayerId = p.id;
        draft.player_id = p.id;
        input.value = p.name;
        dropdown.classList.add('hidden');
        highlightedIndex = -1;
        onPlayerSelected(p);   // ← НОВОЕ: уведомляем родителя
        onSelect();
    }

    // Обработчики input
    input.addEventListener('input', () => {
        // Если пользователь начал печатать — сбрасываем выбор
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
        // Небольшая задержка, чтобы клик по элементу успел сработать
        setTimeout(() => {
            dropdown.classList.add('hidden');
            // Если введено значение, но не выбрано — сбрасываем
            if (selectedPlayerId === null) {
                input.value = '';
            }
        }, 150);
    });

    // Клавиатурная навигация
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

/**
 * Рендерит список участников.
 */
function renderPlayerDrafts(): void {
    if (!playersListBox) return;
    playersListBox.innerHTML = '';

    drafts.forEach((draft, index) => {
        const row = document.createElement('div');
        row.className = 'player-entry';

        // --- Селект расы создаём заранее (пустой) ---
        const raceSelect = document.createElement('select');
        raceSelect.className = 'race-select';

        // --- Автокомплит, с колбэком на выбор игрока ---
        const { wrapper: autocompleteWrap } = createPlayerAutocomplete(
            draft,
            () => {
                markDirty();
            },
            (player) => {
                // Автоматически ставим доминирующую расу игрока
                if (player.dominant_race) {
                    draft.race = player.dominant_race;
                    raceSelect.value = player.dominant_race;
                }
            }
        );

        // --- Теперь заполняем селект расы опциями ---
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
            markDirty();
        });
        winnerWrap.appendChild(winnerCheck);
        const winnerText = document.createElement('span');
        winnerText.textContent = t('games.winner_label');
        winnerWrap.appendChild(winnerText);

        // --- Удалить ---
        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'remove-player';
        removeBtn.textContent = '✕';
        removeBtn.title = t('games.remove_player');
        removeBtn.addEventListener('click', () => {
            drafts.splice(index, 1);
            renderPlayerDrafts();
            markDirty();
        });

        row.append(autocompleteWrap, raceSelect, winnerWrap, removeBtn);
        playersListBox.appendChild(row);
    });
}

/**
 * Собирает данные формы и отправляет на сервер.
 */
async function submitGameForm(e: Event): Promise<void> {
    e.preventDefault();
    if (!form) return;

    if (!playedAtInput?.value) {
        alert(t('games.error_no_date'));
        return;
    }
    if (!formatSelect?.value || !hostSelect?.value || !mapSelect?.value || !modSelect?.value) {
        alert(t('games.error_no_refs'));
        return;
    }

    const filledPlayers = drafts.filter((d) => d.player_id !== null);
    if (filledPlayers.length === 0) {
        alert(t('games.error_no_players'));
        return;
    }

    const ids = filledPlayers.map((d) => d.player_id);
    const uniqueIds = new Set(ids);
    if (uniqueIds.size !== ids.length) {
        alert(t('games.error_duplicate_player'));
        return;
    }

    const hasWinner = filledPlayers.some((d) => d.is_winner);
    if (!hasWinner) {
        alert(t('games.error_no_winner'));
        return;
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
    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.textContent = t('common.saving');
    }

    try {
        if (editingGameId !== null) {
            // Обновление
            await apiRequest(`/api/games/${editingGameId}`, {
                method: 'PATCH',
                token: state.token,
                body: payload,
            });
        } else {
            // Создание
            await apiRequest('/api/games', {
                method: 'POST',
                token: state.token,
                body: payload,
            });
        }
        closeGameModal(true);
        await loadGames();
    } catch (err) {
        alert(t('games.save_error') + (err instanceof Error ? err.message : String(err)));
    } finally {
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.textContent = t('common.save');
        }
    }
}

// Привязываем обработчики
modalClose?.addEventListener('click', () => closeGameModal());
cancelBtn?.addEventListener('click', () => closeGameModal());
form?.addEventListener('submit', (e) => void submitGameForm(e));

addPlayerBtn?.addEventListener('click', () => {
    drafts.push({ player_id: null, race: 'T', is_winner: false, eliminated_at: null });
    renderPlayerDrafts();
});

// Закрытие по клику вне окна
modal?.addEventListener('click', (e) => {
    if (e.target === modal) closeGameModal();
});

// Закрытие по Escape
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal && !modal.classList.contains('hidden')) {
        closeGameModal();
    }
});

async function openEditGameModal(gameId: number): Promise<void> {
    if (!modal) return;

    // Загружаем полные данные игры
    let gameFull: GameFull;
    try {
        const res = await apiRequest<{ game: GameFull }>(`/api/games/${gameId}`);
        gameFull = res.game;
    } catch (err) {
        alert(t('games.load_one_error') + (err instanceof Error ? err.message : String(err)));
        return;
    }

    // Загружаем игроков и справочники (если ещё не загружены)
    await loadPlayersIfNeeded();
    if (cachedFormats.length === 0) {
        await loadAllRefs();
    }

    // Заголовок
    modalTitle && (modalTitle.textContent = t('games.form_title_edit'));

    // Заполняем селекты
    fillSelect(formatSelect, cachedFormats, t('games.select_placeholder'));
    fillSelect(hostSelect, cachedHosts, t('games.select_placeholder'));
    fillSelect(mapSelect, cachedMaps, t('games.select_placeholder'));
    fillSelect(modSelect, cachedMods, t('games.select_placeholder'));

    // Устанавливаем значения
    if (formatSelect && gameFull.format) formatSelect.value = String(gameFull.format.id);
    if (hostSelect && gameFull.host) hostSelect.value = String(gameFull.host.id);
    if (mapSelect && gameFull.map) mapSelect.value = String(gameFull.map.id);
    if (modSelect && gameFull.mod) modSelect.value = String(gameFull.mod.id);

    // Дата
    if (playedAtInput) {
        playedAtInput.value = toDatetimeLocal(new Date(gameFull.played_at));
    }

    // Длительность и заметки
    if (durationInput) durationInput.value = gameFull.duration_min ? String(gameFull.duration_min) : '';
    if (notesInput) notesInput.value = gameFull.notes ?? '';

    // Участники
    drafts = gameFull.players.map((p) => ({
        player_id: p.player_id,
        race: p.race,
        is_winner: p.is_winner,
        eliminated_at: p.eliminated_at,
    }));
    renderPlayerDrafts();

    // Запоминаем, что редактируем
    editingGameId = gameId;

    // Сбрасываем флаг «грязной» формы (только что загрузили — изменений ещё нет)
    isDirty = false;

    modal.classList.remove('hidden');
}

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
            method: 'DELETE',
            token: state.token,
        });
        await loadGames();
    } catch (err) {
        alert(t('games.delete_error') + (err instanceof Error ? err.message : String(err)));
    }
}

void init();
