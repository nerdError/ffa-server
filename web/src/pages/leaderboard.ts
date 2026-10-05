import { apiRequest } from '../api';
import { t } from '../i18n';
import { navigateTo } from '../router';
import { state } from '../state';

let currentMode: 'all' | 'solo' | 'team' = 'all';

type SortKey = 'name' | 'activity' | 'games' | 'days' | 'wins' | 'winrate' | 'quality' | 'avg_place' | 'elo';
type SortDirection = 'asc' | 'desc';

let sortKey: SortKey = 'activity';
let sortDirection: SortDirection = 'desc';

let cachedLeaderboard: LeaderboardEntry[] = [];

function applySort(players: LeaderboardEntry[]): LeaderboardEntry[] {
    const dir = sortDirection === 'asc' ? 1 : -1;

    return [...players].sort((a, b) => {
        let av: number | string | null;
        let bv: number | string | null;

        switch (sortKey) {
            case 'name':
                av = a.name.toLowerCase();
                bv = b.name.toLowerCase();
                break;
            case 'activity':
                av = a.activity_score;
                bv = b.activity_score;
                break;
            case 'games':
                av = a.games_played;
                bv = b.games_played;
                break;
            case 'days':
                av = a.game_days;
                bv = b.game_days;
                break;
            case 'wins':
                av = a.wins;
                bv = b.wins;
                break;
            case 'winrate':
                av = a.winrate;
                bv = b.winrate;
                break;
            case 'quality':
                av = a.quality;
                bv = b.quality;
                break;
            case 'avg_place':
                av = a.avg_place;
                bv = b.avg_place;
                break;
            case 'elo':
                av = a.elo;
                bv = b.elo;
                break;
        }

        // null всегда в конец, независимо от направления
        if (av === null && bv === null) return 0;
        if (av === null) return 1;
        if (bv === null) return -1;

        if (typeof av === 'string' && typeof bv === 'string') {
            return av.localeCompare(bv, 'ru') * dir;
        }
        return (Number(av) - Number(bv)) * dir;
    });
}

function handleSortClick(key: SortKey): void {
    if (sortKey === key) {
        sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
        sortKey = key;
        // Для текстовых — asc по умолчанию, для чисел — desc
        sortDirection = key === 'name' ? 'asc' : 'desc';
    }

    const container = document.getElementById('leaderboard-container');
    if (!container) return;
    renderLeaderboard(applySort(cachedLeaderboard), container);
    renderModeSwitch();
}

function renderModeSwitch(): void {
    const container = document.getElementById('leaderboard-container');
    if (!container) return;

    let switcher = document.getElementById('leaderboard-mode-switch');
    if (!switcher) {
        switcher = document.createElement('div');
        switcher.id = 'leaderboard-mode-switch';
        switcher.className = 'leaderboard-mode-switch';
    } else {
        switcher.innerHTML = '';
    }

    const modes: Array<{ key: 'all' | 'solo' | 'team'; label: string }> = [
        { key: 'all', label: t('leaderboard.mode_all') },
        { key: 'solo', label: t('leaderboard.mode_solo') },
        { key: 'team', label: t('leaderboard.mode_team') },
    ];

    for (const m of modes) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'view-toggle-btn' + (currentMode === m.key ? ' is-active' : '');
        btn.textContent = m.label;
        btn.addEventListener('click', () => {
            void loadLeaderboard(m.key);
        });
        switcher.appendChild(btn);
    }

    // Ставим переключатель наверх
    if (switcher.parentElement !== container) {
        container.prepend(switcher);
    }
}
interface LeaderboardEntry {
    player_id: number;
    name: string;
    aka: string | null;
    elo: number;
    games_played: number;
    wins: number;
    winrate: number;
    activity_score: number;
    quality: number;
    avg_place: number | null;
    game_days: number;
    rank: number;
}

let abortController: AbortController | null = null;

export function mountLeaderboard(_params: URLSearchParams): void {
    const screen = document.getElementById('screen-leaderboard');
    if (screen) screen.classList.remove('hidden');

    abortController = new AbortController();
    void loadLeaderboard();
}

export function unmountLeaderboard(): void {
    abortController?.abort();
    abortController = null;
}

async function loadLeaderboard(mode: 'all' | 'solo' | 'team' = 'all'): Promise<void> {
    const container = document.getElementById('leaderboard-container');
    if (!container) return;
    container.innerHTML = '<div class="skeleton skeleton-block"></div>';

    const modeChanged = currentMode !== mode;
    currentMode = mode;

    // При смене режима — сбрасываем сортировку на дефолтную
    if (modeChanged) {
        sortKey = 'activity';
        sortDirection = 'desc';
    }

    try {
        const res = await apiRequest<{ players: LeaderboardEntry[] }>(
            `/api/ratings/leaderboard?mode=${mode}`
        );
        cachedLeaderboard = res.players;
        renderLeaderboard(applySort(cachedLeaderboard), container);
        renderModeSwitch();
    } catch {
        container.innerHTML = `<p class="error">${t('common.error')}</p>`;
    }
}

function renderLeaderboard(players: LeaderboardEntry[], container: HTMLElement): void {
    if (players.length === 0) {
        container.innerHTML = `<p class="hint">${t('leaderboard.empty')}</p>`;
        return;
    }

    // Сохраняем переключатель, если он есть
    const existingSwitch = document.getElementById('leaderboard-mode-switch');

    container.innerHTML = '';

    const wrap = document.createElement('div');
    wrap.className = 'leaderboard-layout';

    const tableWrap = document.createElement('div');
    tableWrap.className = 'leaderboard-table-wrap';

    const table = document.createElement('table');
    table.className = 'leaderboard-table';

    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');

    // Заголовок "#" — не кликабельный
    const thRank = document.createElement('th');
    thRank.textContent = '#';
    headRow.appendChild(thRank);

    // Определяем колонки: label, sortKey
    const columns: Array<{ label: string; key: SortKey }> = [
        { label: t('players.col.name'), key: 'name' },
        { label: t('leaderboard.activity'), key: 'activity' },
        { label: t('leaderboard.games'), key: 'games' },
        { label: t('leaderboard.days'), key: 'days' },
        { label: t('leaderboard.wins'), key: 'wins' },
        { label: t('leaderboard.winrate'), key: 'winrate' },
        { label: t('leaderboard.quality'), key: 'quality' },
        { label: t('leaderboard.avg_place'), key: 'avg_place' },
    ];

    for (const col of columns) {
        const th = document.createElement('th');
        th.textContent = col.label;
        th.dataset.sortKey = col.key;
        th.classList.add('sortable');

        if (sortKey === col.key) {
            th.classList.add('is-sorted');
            th.classList.toggle('is-sorted-asc', sortDirection === 'asc');
            th.classList.toggle('is-sorted-desc', sortDirection === 'desc');
            th.textContent = col.label + (sortDirection === 'asc' ? ' ▲' : ' ▼');
        }

        th.addEventListener('click', () => {
            handleSortClick(col.key);
        });

        headRow.appendChild(th);
    }

    thead.appendChild(headRow);
    table.appendChild(thead);

    // Тело таблицы — как было (без изменений), только нумерация rank
    // теперь должна соответствовать сортировке, а не «сырому» rank из API.
    const tbody = document.createElement('tbody');
    players.forEach((p, index) => {
        const tr = document.createElement('tr');
        if (index === 0) tr.classList.add('rank-gold');
        else if (index === 1) tr.classList.add('rank-silver');
        else if (index === 2) tr.classList.add('rank-bronze');

        if (state.user?.player_id && p.player_id === state.user.player_id) {
            tr.classList.add('is-me');
        }

        const tdRank = document.createElement('td');
        tdRank.textContent = String(index + 1);   // ← index в массиве после сортировки
        tr.appendChild(tdRank);

        const tdName = document.createElement('td');
        const link = document.createElement('a');
        link.href = `/?player=${encodeURIComponent(p.name)}`;
        link.className = 'player-name-link';
        link.textContent = p.name;
        link.addEventListener('click', (e) => {
            e.preventDefault();
            navigateTo(`/?player=${encodeURIComponent(p.name)}`);
        });
        tdName.appendChild(link);
        if (p.aka) {
            const aka = document.createElement('span');
            aka.className = 'player-aka';
            aka.textContent = ` aka ${p.aka}`;
            tdName.appendChild(aka);
        }
        tr.appendChild(tdName);

        const tdActivity = document.createElement('td');
        tdActivity.className = 'activity-cell';
        tdActivity.textContent = p.activity_score.toFixed(1);
        tr.appendChild(tdActivity);

        const tdGames = document.createElement('td');
        tdGames.textContent = String(p.games_played);
        tr.appendChild(tdGames);

        const tdDays = document.createElement('td');
        tdDays.textContent = String(p.game_days);
        tr.appendChild(tdDays);

        const tdWins = document.createElement('td');
        tdWins.textContent = String(p.wins);
        tr.appendChild(tdWins);

        const tdWinrate = document.createElement('td');
        tdWinrate.textContent = `${p.winrate}%`;
        tr.appendChild(tdWinrate);

        const tdQuality = document.createElement('td');
        tdQuality.className = 'quality-cell';
        tdQuality.textContent = p.quality.toFixed(2);
        tr.appendChild(tdQuality);

        const tdAvg = document.createElement('td');
        tdAvg.textContent = p.avg_place !== null ? p.avg_place.toFixed(2) : '—';
        tr.appendChild(tdAvg);

        tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    tableWrap.appendChild(table);

    // Справка
    const helpBox = document.createElement('aside');
    helpBox.className = 'leaderboard-help';
    helpBox.innerHTML = `
  <h3>${t('leaderboard.help_title')}</h3>
  <p>${t('leaderboard.help_intro')}</p>
  <ul>
    <li>${t('leaderboard.help_activity')}</li>
    <li>${t('leaderboard.help_place')}</li>
    <li>${t('leaderboard.help_not_elim')}</li>
    <li>${t('leaderboard.help_winner')}</li>
    <li>${t('leaderboard.help_early')}</li>
    <li>${t('leaderboard.help_days')}</li>
    <li>${t('leaderboard.help_quality')}</li>
  </ul>
  <p class="hint">${t('leaderboard.help_outro')}</p>
`;

    wrap.append(tableWrap, helpBox);
    container.appendChild(wrap);

    // Возвращаем переключатель режима наверх
    if (existingSwitch) {
        container.prepend(existingSwitch);
    }
}