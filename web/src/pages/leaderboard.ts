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

    const modeChanged = currentMode !== mode;
    currentMode = mode;

    if (modeChanged) {
        sortKey = 'activity';
        sortDirection = 'desc';
    }

    // Если таблицы ещё нет — рисуем скелетон
    let table = container.querySelector<HTMLTableElement>('.leaderboard-table');
    if (!table) {
        container.innerHTML = '';
        const skeleton = document.createElement('div');
        skeleton.className = 'skeleton skeleton-block';
        skeleton.style.height = '400px';
        container.appendChild(skeleton);
    } else {
        // Плавно затемняем текущую таблицу
        table.classList.add('is-loading');
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

    // Проверяем, есть ли уже таблица
    let table = container.querySelector<HTMLTableElement>('.leaderboard-table');
    let tbody = table?.querySelector<HTMLTableSectionElement>('tbody');
    let thead = table?.querySelector<HTMLTableSectionElement>('thead');

    // Если таблицы нет — создаём всю структуру (как раньше)
    if (!table || !tbody || !thead) {
        container.innerHTML = '';

        const wrap = document.createElement('div');
        wrap.className = 'leaderboard-layout';

        const tableWrap = document.createElement('div');
        tableWrap.className = 'leaderboard-table-wrap';

        table = document.createElement('table');
        table.className = 'leaderboard-table';
        thead = document.createElement('thead');
        tbody = document.createElement('tbody');
        table.append(thead, tbody);
        tableWrap.appendChild(table);

        const helpBox = document.createElement('aside');
        helpBox.className = 'leaderboard-help';
        helpBox.innerHTML = buildHelpHtml();

        wrap.append(tableWrap, helpBox);
        container.appendChild(wrap);

        // Переключатель режимов сверху
        renderModeSwitch();
    }

    // --- Обновляем THEAD (заголовки со стрелками) ---
    thead.innerHTML = '';
    const headRow = document.createElement('tr');
    const thRank = document.createElement('th');
    thRank.textContent = '#';
    headRow.appendChild(thRank);

    const columns: Array<{ label: string; key: SortKey }> = [
        { label: t('players.col.name'), key: 'name' },
        { label: t('leaderboard.activity'), key: 'activity' },
        { label: "SKILL " + t('players.col.elo') + "", key: 'elo' },
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

        th.addEventListener('click', () => handleSortClick(col.key));
        headRow.appendChild(th);
    }
    thead.appendChild(headRow);

    // --- Обновляем TBODY (данные) ---
    tbody.innerHTML = '';
    players.forEach((p, index) => {
        const tr = document.createElement('tr');
        if (index === 0) tr.classList.add('rank-gold');
        else if (index === 1) tr.classList.add('rank-silver');
        else if (index === 2) tr.classList.add('rank-bronze');

        if (state.user?.player_id && p.player_id === state.user.player_id) {
            tr.classList.add('is-me');
        }

        // ... остальные ячейки как раньше
        const tdRank = document.createElement('td');
        tdRank.textContent = String(index + 1);
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

        const tdElo = document.createElement('td');
        // tdElo.className = 'elo-cel';
        tdElo.textContent = "" + p.elo + "";
        tr.appendChild(tdElo);

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

    // Плавное появление
    table.classList.remove('is-loading');
    table.classList.add('just-updated');
    setTimeout(() => table.classList.remove('just-updated'), 300);
}

function buildHelpHtml(): string {
    return `
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
}