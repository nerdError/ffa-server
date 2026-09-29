import { apiRequest } from '../api';
import { state } from '../state';
import { type PlayerWithStats, type PlayersListResponse } from '../types';

import terranIcon from '../../assets/race/terran.svg';
import zergIcon from '../../assets/race/zerg.svg';
import protossIcon from '../../assets/race/protoss.svg';
import type { Race, StatKey } from '../types';
import { pickRaceColor, STAT_ORDER } from '../radar';
import randomIcon from '../../assets/race/random.svg';

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
    onOpenPlayer: (id: number) => void;
}

export async function loadPlayers(cb: PlayersCallbacks): Promise<void> {
    const tbody = document.getElementById('players-tbody');
    const errBox = document.getElementById('players-error');
    if (!tbody || !errBox) return;

    errBox.classList.add('hidden');
    tbody.innerHTML = '<tr><td colspan="9">Загрузка…</td></tr>';

    try {
        const { players } = await apiRequest<PlayersListResponse>('/api/players');
        cachedPlayers = players;

        // Применяем дефолтную сортировку
        const sorted = sortPlayers(cachedPlayers, sortKey, sortDirection);
        renderPlayersTable(sorted, cb);
        bindSorting(cb);
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

    for (const r of races) {
        const img = document.createElement('img');
        img.src = RACE_ICON_URL[r];
        img.alt = RACE_LABELS[r];
        img.title = RACE_LABELS[r];
        img.className = `race-icon race-icon-${r}`;
        td.appendChild(img);
    }
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
        link.addEventListener('click', (e) => {
            e.preventDefault();
            cb.onOpenPlayer(p.id);
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

        tbody.appendChild(tr);
    }
}

export function bindCreatePlayer(onCreated: () => void): void {
    const form = document.getElementById('form-create-player') as HTMLFormElement | null;
    if (!form) return;

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

