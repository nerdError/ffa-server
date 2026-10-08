import { apiRequest } from '../api';
import { t } from '../i18n';
import { navigateTo } from '../router';
import { state } from '../state';

type Mode = 'all' | 'solo' | 'team' | 'ffa-league' | 'team-ffa';

/** Сезонные зачёты: только победы/игры по конкретному формату, без ELO и активности. */
const isSeasonMode = (mode: Mode): boolean => mode === 'ffa-league' || mode === 'team-ffa';

let currentMode: Mode = 'all';

/** Отдельный фильтр: считать только игры за последние 30 дней (не для сезонных зачётов). */
let last30d = false;

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

    const modes: Array<{ key: Mode; label: string }> = [
        { key: 'all', label: t('leaderboard.mode_all') },
        { key: 'solo', label: t('leaderboard.mode_solo') },
        { key: 'team', label: t('leaderboard.mode_team') },
        { key: 'ffa-league', label: t('leaderboard.mode_league_s3') },
        { key: 'team-ffa', label: t('leaderboard.mode_team_s1') },
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

    // Отдельный фильтр «последние 30 дней» — работает для all/solo/team, не для сезонных зачётов.
    const disabled = isSeasonMode(currentMode);
    const label = document.createElement('label');
    label.className = 'lb-30d-filter' + (disabled ? ' is-disabled' : '');
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = last30d;
    box.disabled = disabled;
    box.addEventListener('change', () => {
        last30d = box.checked;
        void loadLeaderboard(currentMode);
    });
    const span = document.createElement('span');
    span.textContent = t('leaderboard.filter_30d');
    label.append(box, span);
    switcher.appendChild(label);

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

async function loadLeaderboard(mode: Mode = 'all'): Promise<void> {
    const container = document.getElementById('leaderboard-container');
    if (!container) return;

    const modeChanged = currentMode !== mode;
    currentMode = mode;

    if (modeChanged) {
        // В сезонных зачётах основной параметр — победы.
        sortKey = isSeasonMode(mode) ? 'wins' : 'activity';
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
            `/api/ratings/leaderboard?mode=${mode}${last30d && !isSeasonMode(mode) ? '&days=30' : ''}`
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

    // Если таблицы нет — создаём всю структуру
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

        wrap.append(tableWrap, helpBox);
        container.appendChild(wrap);

        // Переключатель режимов сверху
        renderModeSwitch();
    }

    // Содержимое справки зависит от режима
    const helpBox = container.querySelector<HTMLElement>('.leaderboard-help');
    if (helpBox) {
        helpBox.innerHTML = isSeasonMode(currentMode) ? buildSeasonHelpHtml() : buildHelpHtml();
    }

    const columns = columnsFor(currentMode);

    // --- Обновляем THEAD (заголовки со стрелками) ---
    thead.innerHTML = '';
    const headRow = document.createElement('tr');
    const thRank = document.createElement('th');
    thRank.textContent = '#';
    headRow.appendChild(thRank);

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

        const tdRank = document.createElement('td');
        tdRank.className = 'lb-rank';
        tdRank.textContent = String(index + 1);
        tr.appendChild(tdRank);

        for (const col of columns) {
            tr.appendChild(buildCell(col.key, col.label, p));
        }

        tbody.appendChild(tr);
    });

    // Плавное появление
    table.classList.remove('is-loading');
    table.classList.add('just-updated');
    setTimeout(() => table.classList.remove('just-updated'), 300);
}

/** Набор колонок для режима: сезонные зачёты без ELO/активности. */
function columnsFor(mode: Mode): Array<{ label: string; key: SortKey }> {
    if (isSeasonMode(mode)) {
        return [
            { label: t('players.col.name'), key: 'name' },
            { label: t('leaderboard.wins'), key: 'wins' },
            { label: t('leaderboard.winrate'), key: 'winrate' },
            { label: t('leaderboard.games'), key: 'games' },
            { label: t('leaderboard.avg_place'), key: 'avg_place' },
        ];
    }
    return [
        { label: t('players.col.name'), key: 'name' },
        { label: t('leaderboard.activity'), key: 'activity' },
        { label: "" + t('players.col.elo') + "", key: 'elo' },
        { label: t('leaderboard.games'), key: 'games' },
        { label: t('leaderboard.days'), key: 'days' },
        { label: t('leaderboard.wins'), key: 'wins' },
        { label: t('leaderboard.winrate'), key: 'winrate' },
        { label: t('leaderboard.quality'), key: 'quality' },
        { label: t('leaderboard.avg_place'), key: 'avg_place' },
    ];
}

function buildCell(key: SortKey, label: string, p: LeaderboardEntry): HTMLTableCellElement {
    const td = document.createElement('td');

    if (key === 'name') {
        td.className = 'lb-name';
        const link = document.createElement('a');
        link.href = `/?player=${encodeURIComponent(p.name)}`;
        link.className = 'player-name-link';
        link.textContent = p.name;
        link.addEventListener('click', (e) => {
            e.preventDefault();
            navigateTo(`/?player=${encodeURIComponent(p.name)}`);
        });
        td.appendChild(link);
        if (p.aka) {
            const aka = document.createElement('span');
            aka.className = 'player-aka';
            aka.textContent = ` aka ${p.aka}`;
            td.appendChild(aka);
        }
        return td;
    }

    // Остальные ячейки: подпись (для мобильного) + значение
    td.className = 'lb-stat';
    if (key === 'activity') td.classList.add('lb-activity');
    if (key === 'elo') td.classList.add('lb-elo');
    if (key === 'activity') td.classList.add('activity-cell');
    if (key === 'quality') td.classList.add('quality-cell');

    const lbl = document.createElement('span');
    lbl.className = 'lb-mobile-label';
    lbl.textContent = label;
    td.appendChild(lbl);

    const val = document.createElement('span');
    val.className = 'lb-value';

    let text = '';
    switch (key) {
        case 'activity':
            text = p.activity_score.toFixed(1);
            break;
        case 'elo':
            text = String(p.elo);
            break;
        case 'games':
            text = String(p.games_played);
            break;
        case 'days':
            text = String(p.game_days);
            break;
        case 'wins':
            text = String(p.wins);
            break;
        case 'winrate':
            text = `${p.winrate}%`;
            break;
        case 'quality':
            text = p.quality.toFixed(2);
            break;
        case 'avg_place':
            text = p.avg_place !== null ? p.avg_place.toFixed(2) : '—';
            break;
    }
    val.textContent = text;
    td.appendChild(val);

    return td;
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

function buildSeasonHelpHtml(): string {
    return `
    <h3>${t('leaderboard.season_help_title')}</h3>
    <p>${t('leaderboard.season_help_text')}</p>
  `;
}