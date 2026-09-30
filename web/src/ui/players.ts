import { apiRequest } from '../api';
import { state } from '../state';
import { type PlayerWithStats, type PlayersListResponse } from '../types';

import terranIcon from '../../assets/race/terran.svg';
import zergIcon from '../../assets/race/zerg.svg';
import protossIcon from '../../assets/race/protoss.svg';
import type { Race, StatKey } from '../types';
import { buildRadarSVG, pickRaceColor, STAT_ORDER } from '../radar';
import randomIcon from '../../assets/race/random.svg';
import { dominantRace } from '../card';
import { openPlayerScreen } from './player-detail';

let viewInitialized = false;

const RACE_ICON_URL: Record<Race, string> = {
    T: terranIcon,
    Z: zergIcon,
    P: protossIcon,
    R: randomIcon,
};

const RACE_LABELS: Record<Race, string> = {
    T: 'Terran',
    Z: 'Zerg',
    P: 'Protoss',
    R: 'Random',
};

type SortDirection = 'asc' | 'desc';
type SortKey = 'name' | 'total' | 'races' | StatKey;

let sortKey: SortKey = 'total';
let sortDirection: SortDirection = 'desc';

/**
 * Хранилище последнего загруженного списка — чтобы пересортировывать
 * без повторного запроса к API.
 */
let cachedPlayers: PlayerWithStats[] = [];

/**
 * Одна ячейка таблицы: полоска заполнения + буква рейтинга.
 * Если значение null — пустая полоска и «—».
 */
function statBarCell(value: number | null, color: string): HTMLTableCellElement {
    const td = document.createElement('td');
    td.className = 'stat-cell';

    const wrap = document.createElement('div');
    wrap.className = 'stat-bar-wrap';
    wrap.style.setProperty('--stat-color', color);

    const bar = document.createElement('div');
    bar.className = 'stat-bar';

    const fill = document.createElement('div');
    fill.className = 'stat-bar-fill';

    if (typeof value === 'number') {
        const pct = Math.max(0, Math.min(100, ((value - 1) / 4) * 80 + 20));
        fill.style.width = `${pct}%`;
    } else {
        fill.style.width = '0%';
        wrap.classList.add('stat-bar-wrap--empty');
    }

    bar.appendChild(fill);
    wrap.appendChild(bar);
    td.appendChild(wrap);
    return td;
}

interface PlayersCallbacks {
    onOpenPlayer: (id: number, name: string) => void;
}

export async function loadPlayers(cb: PlayersCallbacks): Promise<void> {
    const tbody = document.getElementById('players-tbody');
    const errBox = document.getElementById('players-error');
    if (!tbody || !errBox) return;

    errBox.classList.add('hidden');
    tbody.innerHTML = '<tr><td colspan="10">Загрузка…</td></tr>';

    try {
        const { players } = await apiRequest<PlayersListResponse>('/api/players');
        cachedPlayers = players;

        // 1. Навешиваем обработчики ОДИН РАЗ
        bindViewToggle();

        // 2. Определяем сохранённый вид (если ещё не задан)
        if (!viewInitialized) {
            const saved = localStorage.getItem('playersView');
            if (saved === 'table' || saved === 'wall') currentView = saved;
            viewInitialized = true;
        }

        // 3. Применяем вид
        setView(currentView);
    } catch (err) {
        errBox.textContent =
            'Не удалось загрузить игроков: ' +
            (err instanceof Error ? err.message : String(err));
        errBox.classList.remove('hidden');
        tbody.innerHTML = '';
    }
}

function fmtRaceCells(races: PlayerWithStats['races']): HTMLTableCellElement {
  const td = document.createElement('td');
  td.className = 'races-cell';

  if (races.length === 0) {
    td.textContent = '—';
    return td;
  }

  // Внутренняя обёртка — flex-контейнер, а сам td остаётся table-cell
  const inner = document.createElement('div');
  inner.className = 'races-cell-inner';

  for (const r of races) {
    const img = document.createElement('img');
    img.src = RACE_ICON_URL[r];
    img.alt = RACE_LABELS[r];
    img.title = RACE_LABELS[r];
    img.className = `race-icon race-icon-${r}`;
    inner.appendChild(img);
  }

  td.appendChild(inner);
  return td;
}

function renderPlayersTable(
    players: PlayerWithStats[],
    cb: PlayersCallbacks
): void {
    const tbody = document.getElementById('players-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';



    if (players.length === 0) {
        tbody.innerHTML =
            '<tr><td colspan="9" class="hint">Пока нет игроков.</td></tr>';
        return;
    }

    for (const p of players) {
        const tr = document.createElement('tr');

        // Имя (ссылка) — в цвет расы
        const tdName = document.createElement('td');
        const link = document.createElement('a');
        link.className = 'player-name-link';
        link.textContent = p.name;
        link.href = '#';
        link.style.color = pickRaceColor(p.races);           // ← цвет расы
        link.style.setProperty('--race-color', pickRaceColor(p.races)); // ← для hover
        link.href = `/?player=${encodeURIComponent(p.name)}`;
        link.addEventListener('click', (e) => {
            e.preventDefault();
            window.history.pushState({}, '', `/?player=${encodeURIComponent(p.name)}`);
            cb.onOpenPlayer(p.id, p.name);
        });
        tdName.appendChild(link);
        tr.appendChild(tdName);

        // Расы
        tr.appendChild(fmtRaceCells(p.races));

        // Статы — в порядке STAT_ORDER
        for (const axis of STAT_ORDER) {
            tr.appendChild(statBarCell(p[axis.key], axis.color));
        }

        // Итого — сумма всех средних
        const tdTotal = document.createElement('td');
        tdTotal.className = 'total-cell';

        const total = STAT_ORDER.reduce((sum, axis) => {
            const v = p[axis.key];
            return sum + (typeof v === 'number' ? v : 0);
        }, 0);

        // Если у игрока вообще нет оценок — показываем «—»
        const hasAny = STAT_ORDER.some((axis) => typeof p[axis.key] === 'number');
        tdTotal.textContent = hasAny ? total.toFixed(2) : '—';

        tr.appendChild(tdTotal);

        // Проверяем, модератор ли текущий пользователь
        const canDelete = Boolean(
            state.user?.is_admin
        );

        // В row добавляем ячейку с кнопкой
        const tdActions = document.createElement('td');
        tdActions.className = 'players-actions-cell';

        if (canDelete) {
            const delBtn = document.createElement('button');
            delBtn.type = 'button';
            delBtn.className = 'player-delete-btn';
            delBtn.title = 'Удалить игрока';
            delBtn.textContent = '🗑';
            delBtn.addEventListener('click', (e) => {
                e.stopPropagation();   // не открывать карточку
                void (async () => {
                    const confirmed = confirm(
                        `Удалить игрока "${p.name}"?\n\n` +
                        `Все оценки (${p.vote_count}) будут удалены безвозвратно.`
                    );
                    if (!confirmed) return;

                    try {
                        await apiRequest(`/api/players/${p.id}`, {
                            method: 'DELETE',
                            token: state.token,
                        });
                        // Перезагружаем список
                        const { players } = await apiRequest<PlayersListResponse>('/api/players');
                        cachedPlayers = players;
                        renderPlayersTable(
                            sortPlayers(cachedPlayers, sortKey, sortDirection),
                            cb
                        );
                    } catch (err) {
                        alert('Не удалось удалить: ' +
                            (err instanceof Error ? err.message : String(err)));
                    }
                })();
            });
            tdActions.appendChild(delBtn);
        }

        tr.appendChild(tdActions);

        tbody.appendChild(tr);
    }
}

export function bindCreatePlayer(onCreated: () => void): void {
    const form = document.getElementById('form-create-player') as HTMLFormElement | null;
    if (!form) return;

    // Скрываем форму для не-модераторов
    if (!state.user?.is_moderator) {
        form.style.display = 'none';
        return;
    }

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!state.token) {
            alert('Нужно войти, чтобы добавлять игроков');
            return;
        }
        const fd = new FormData(form);
        const name = String(fd.get('name') ?? '').trim();
        if (!name) return;

        try {
            await apiRequest('/api/players', {
                method: 'POST',
                token: state.token,
                body: { name },
            });
            form.reset();
            onCreated();
        } catch (err) {
            alert('Не удалось добавить игрока: ' +
                (err instanceof Error ? err.message : String(err)));
        }
    });
}

/**
 * Считает «итого» — сумму всех ненулевых параметров.
 * Если оценок нет — возвращает null, чтобы такие игроки уходили в конец.
 */
function calcTotal(p: PlayerWithStats): number | null {
    let sum = 0;
    let hasAny = false;
    for (const axis of STAT_ORDER) {
        const v = p[axis.key];
        if (typeof v === 'number') {
            sum += v;
            hasAny = true;
        }
    }
    return hasAny ? sum : null;
}

type SimpleSortKey = Exclude<SortKey, 'races'>;

function getSortValue(
    p: PlayerWithStats,
    key: SimpleSortKey
): string | number | null {
    if (key === 'name') return p.name.toLowerCase();
    if (key === 'total') return calcTotal(p);
    return p[key]; // теперь key — StatKey, p[key] — number | null
}

/**
 * Считает частоту каждой расы среди всех игроков.
 * Возвращает карту «раса → сколько игроков её имеют».
 */
function countRacePopularity(
    players: PlayerWithStats[]
): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const p of players) {
        for (const r of p.races) {
            counts[r] = (counts[r] ?? 0) + 1;
        }
    }
    return counts;
}

/**
 * Возвращает «ключевую расу» игрока — самую популярную из его рас.
 * Используется для группировки при сортировке по расам.
 */
function primaryRace(
    p: PlayerWithStats,
    popularity: Record<string, number>
): string {
    if (p.races.length === 0) return 'zzz-empty'; // пустые — в самый конец
    // Берём ту расу игрока, у которой выше популярность
    return [...p.races].sort(
        (a, b) => (popularity[b] ?? 0) - (popularity[a] ?? 0)
    )[0] ?? 'zzz-empty';
}

/**
 * Сортирует список игроков.
 * Особый случай: 'races' — группировка по популярности рас,
 * внутри группы — алфавит по имени.
 */
function sortPlayers(
    players: PlayerWithStats[],
    key: SortKey,
    dir: SortDirection
): PlayerWithStats[] {
    // --- Сортировка по расам: своя логика ---
    if (key === 'races') {
        const popularity = countRacePopularity(players);

        // Порядок рас: сначала по популярности, потом алфавит для стабильности
        const raceOrder = Object.keys(popularity).sort((a, b) => {
            const diff = (popularity[b] ?? 0) - (popularity[a] ?? 0);
            return diff !== 0 ? diff : a.localeCompare(b);
        });

        // Если сортировка по возрастанию — переворачиваем порядок рас
        const orderedRaces = dir === 'asc' ? raceOrder : [...raceOrder].reverse();

        const raceIndex: Record<string, number> = {};
        orderedRaces.forEach((r, i) => {
            raceIndex[r] = i;
        });

        return [...players].sort((a, b) => {
            const ra = primaryRace(a, popularity);
            const rb = primaryRace(b, popularity);

            const ia = raceIndex[ra] ?? 999;
            const ib = raceIndex[rb] ?? 999;

            // Сначала по индексу расы
            if (ia !== ib) return ia - ib;

            // Внутри одной расы — алфавит по имени (всегда по возрастанию)
            return a.name.localeCompare(b.name, 'ru');
        });
    }

    // --- Обычная сортировка ---
    const mult = dir === 'asc' ? 1 : -1;
    return [...players].sort((a, b) => {
        const av = getSortValue(a, key);
        const bv = getSortValue(b, key);

        if (av === null && bv === null) return 0;
        if (av === null) return 1;
        if (bv === null) return -1;

        if (typeof av === 'string' && typeof bv === 'string') {
            return av.localeCompare(bv, 'ru') * mult;
        }

        return (Number(av) - Number(bv)) * mult;
    });
}

/**
 * Навешивает обработчики клика на заголовки таблицы.
 * Вызывается один раз после первой загрузки.
 * Идемпотентна — повторный вызов не создаёт дублей.
 */
let sortingBound = false;
function bindSorting(cb: PlayersCallbacks): void {
    if (sortingBound) return;
    sortingBound = true;

    const table = document.querySelector('.players-table');
    if (!table) return;

    const headers = table.querySelectorAll<HTMLTableCellElement>('th[data-sort-key]');
    headers.forEach((th) => {
        th.addEventListener('click', () => {
            const key = th.dataset.sortKey as SortKey | undefined;
            if (!key) return;

            if (sortKey === key) {
                // тот же столбец — меняем направление
                sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
            } else {
                // новый столбец — начинаем с убывания
                sortKey = key;
                sortDirection = 'desc';
            }

            const sorted = sortPlayers(cachedPlayers, sortKey, sortDirection);
            renderPlayersTable(sorted, cb);
            updateSortIndicators();
        });
    });

    updateSortIndicators();
}

/**
 * Обновляет стрелки ▲ / ▼ в заголовках.
 */
function updateSortIndicators(): void {
    const table = document.querySelector('.players-table');
    if (!table) return;

    table.querySelectorAll<HTMLTableCellElement>('th[data-sort-key]').forEach((th) => {
        const key = th.dataset.sortKey as SortKey | undefined;
        const label = th.dataset.label ?? th.textContent ?? '';

        // Убираем старую стрелку, если была
        const cleanLabel = label.replace(/\s*[▲▼]$/, '');
        th.textContent = cleanLabel;

        if (key === sortKey) {
            const arrow = sortDirection === 'asc' ? '▲' : '▼';
            th.textContent = `${cleanLabel} ${arrow}`;
            th.classList.add('is-sorted');
            th.classList.toggle('is-sorted-asc', sortDirection === 'asc');
            th.classList.toggle('is-sorted-desc', sortDirection === 'desc');
        } else {
            th.classList.remove('is-sorted', 'is-sorted-asc', 'is-sorted-desc');
        }
    });
}

// ============================================================
// Вид «Стили игры» (стена)
// ============================================================

type ViewMode = 'table' | 'wall';

let currentView: ViewMode = 'table';

/**
 * Строит одну плитку игрока для стены.
 */
function buildTile(player: PlayerWithStats): HTMLAnchorElement {
    const race = dominantRace(player.races);
    const color = pickRaceColor(player.races);

    const tile = document.createElement('a');
    tile.className = 'player-tile';
    tile.href = `/?player=${encodeURIComponent(player.name)}`;
    tile.style.setProperty('--race-color', color);

    // Шапка: иконка + ник
    const header = document.createElement('div');
    header.className = 'player-tile-header';

    if (race !== 'MIXED') {
        const img = document.createElement('img');
        img.src = RACE_ICON_URL[race];
        img.alt = RACE_LABELS[race];
        img.className = 'player-tile-icon';
        header.appendChild(img);
    }

    const name = document.createElement('span');
    name.className = 'player-tile-name';
    name.textContent = player.name;
    header.appendChild(name);

    tile.appendChild(header);

    // Радар
    const radarWrap = document.createElement('div');
    radarWrap.className = 'player-tile-radar';
    radarWrap.innerHTML = buildRadarSVG({
        stats: player,
        color,
        size: 330,
        uniqueId: `player-${player.id}`,
        showVertices: false,
    });
    tile.appendChild(radarWrap);

    // Подвал: голоса + итого
    const footer = document.createElement('div');
    footer.className = 'player-tile-footer';

    const total = calcTotal(player);

    const votes = document.createElement('span');
    votes.innerHTML = `Голосов: <strong>${player.vote_count}</strong>`;

    const totalEl = document.createElement('span');
    totalEl.innerHTML = `Итого: <strong>${total !== null ? total.toFixed(2) : '—'}</strong>`;

    footer.append(votes, totalEl);
    tile.appendChild(footer);

    return tile;
}

/**
 * Рендерит стену из массива игроков.
 */
function renderWall(players: PlayerWithStats[]): void {
    const wall = document.getElementById('players-wall');
    if (!wall) return;

    wall.innerHTML = '';

    if (players.length === 0) {
        wall.innerHTML = '<p class="hint">Пока нет игроков.</p>';
        return;
    }

    // Сортируем по «Итого» по убыванию
    const sorted = [...players].sort((a, b) => {
        const at = calcTotal(a) ?? -1;
        const bt = calcTotal(b) ?? -1;
        return bt - at;
    });

    for (const p of sorted) {
        wall.appendChild(buildTile(p));
    }
}

/**
 * Переключает вид: table ↔ wall.
 */
function setView(view: ViewMode): void {
    currentView = view;

    const tableView = document.getElementById('players-table-view');
    const wallView = document.getElementById('players-wall-view');

    if (!tableView || !wallView) {
        return;
    }

    if (view === 'table') {
        tableView.classList.remove('hidden');
        wallView.classList.add('hidden');
        renderPlayersTable(
            sortPlayers(cachedPlayers, sortKey, sortDirection),
            { 
                onOpenPlayer: (id) => void openPlayerScreen(id) 
            }
        );
    } 
    else {
        tableView.classList.add('hidden');
        wallView.classList.remove('hidden');
        renderWall(cachedPlayers);
    }

    document.querySelectorAll<HTMLButtonElement>('.view-toggle-btn').forEach((btn) => {
        btn.classList.toggle('is-active', btn.dataset.view === view);
    });

    localStorage.setItem('playersView', view);
}

/**
 * Навешивает обработчики на переключатель видов.
 */
let viewToggleBound = false;

function bindViewToggle(): void {
    if (viewToggleBound) return;

    const toggle = document.getElementById('view-toggle');
    if (!toggle) {
        console.warn('[players] #view-toggle not found');
        return;
    }

    toggle.addEventListener('click', (e) => {
        const target = (e.target as HTMLElement).closest('.view-toggle-btn') as HTMLElement | null;
        if (!target) return;

        const view = target.dataset.view as ViewMode | undefined;
        if (view === 'table' || view === 'wall') {
            setView(view);
        }
    });

    viewToggleBound = true;
}