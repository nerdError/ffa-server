import './styles/main.css';
import { apiRequest } from './api';
import { buildRadarSVG, pickRaceColor, STAT_ORDER } from './radar';
import type { PlayerWithStats, PlayersListResponse, Race } from './types';

import terranIcon from '../assets/race/terran.svg';
import zergIcon from '../assets/race/zerg.svg';
import protossIcon from '../assets/race/protoss.svg';
import randomIcon from '../assets/race/random.svg';

const RACE_ICON_URL: Record<Race, string> = {
    T: terranIcon,
    Z: zergIcon,
    P: protossIcon,
    R: randomIcon,
};

const RACE_NAMES: Record<Race | 'MIXED', string> = {
    T: 'Terran',
    Z: 'Zerg',
    P: 'Protoss',
    R: 'Random',
    MIXED: 'Mixed',
};

function dominantRace(races: Race[]): Race | 'MIXED' {
    if (races.length === 0) return 'MIXED';
    if (races.length === 1) return races[0] ?? 'MIXED';
    return 'MIXED';
}

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

function buildTile(player: PlayerWithStats): HTMLAnchorElement {
    const race = dominantRace(player.races);
    const color = pickRaceColor(player.races);

    const tile = document.createElement('a');
    tile.className = 'player-tile';
    tile.href = `/?player=${player.id}`;
    tile.style.setProperty('--race-color', color);

    // --- Шапка: иконка + ник ---
    const header = document.createElement('div');
    header.className = 'player-tile-header';

    if (race !== 'MIXED') {
        const img = document.createElement('img');
        img.src = RACE_ICON_URL[race];
        img.alt = RACE_NAMES[race];
        img.className = 'player-tile-icon';
        header.appendChild(img);
    }

    const name = document.createElement('span');
    name.className = 'player-tile-name';
    name.textContent = player.name;
    header.appendChild(name);

    tile.appendChild(header);

    // --- Радар ---
    const radarWrap = document.createElement('div');
    radarWrap.className = 'player-tile-radar';
    radarWrap.innerHTML = buildRadarSVG({
        stats: player,
        color,
        size: 330,                       // ← было 220 или 260
        uniqueId: `player-${player.id}`,
        showVertices: false,
    });
    tile.appendChild(radarWrap);

    // --- Подвал: голоса + итого ---
    const footer = document.createElement('div');
    footer.className = 'player-tile-footer';

    const votes = document.createElement('span');
    votes.innerHTML = `Голосов: <strong>${player.vote_count}</strong>`;

    const total = calcTotal(player);
    const totalEl = document.createElement('span');
    totalEl.innerHTML = `Итого: <strong>${total !== null ? total.toFixed(2) : '—'}</strong>`;

    footer.append(votes, totalEl);
    tile.appendChild(footer);

    return tile;
}

async function loadWall(): Promise<void> {
    const wall = document.getElementById('players-wall');
    const errBox = document.getElementById('players-wall-error');
    const count = document.getElementById('players-wall-count');
    if (!wall || !errBox) return;

    errBox.classList.add('hidden');

    try {
        const res = await apiRequest<PlayersListResponse>('/api/players');
        const players = res.players;

        wall.innerHTML = '';
        if (players.length === 0) {
            wall.innerHTML = '<p class="hint">Пока нет игроков.</p>';
            if (count) count.textContent = '';
            return;
        }

        if (count) {
            count.textContent = `Всего игроков: ${players.length}`;
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
    } catch (err) {
        errBox.textContent =
            'Не удалось загрузить игроков: ' +
            (err instanceof Error ? err.message : String(err));
        errBox.classList.remove('hidden');
        wall.innerHTML = '';
    }
}

void loadWall();