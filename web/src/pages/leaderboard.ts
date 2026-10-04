import { apiRequest } from '../api';
import { t } from '../i18n';
import { navigateTo } from '../router';
import { state } from '../state';

interface LeaderboardEntry {
    player_id: number;
    name: string;
    aka: string | null;
    elo: number;
    games_played: number;
    wins: number;
    winrate: number;
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

async function loadLeaderboard(): Promise<void> {
    const container = document.getElementById('leaderboard-container');
    if (!container) return;

    container.innerHTML = '<div class="skeleton skeleton-block"></div>';

    try {
        const res = await apiRequest<{ players: LeaderboardEntry[] }>('/api/ratings/leaderboard');
        renderLeaderboard(res.players, container);
    } catch {
        container.innerHTML = `<p class="error">${t('common.error')}</p>`;
    }
}

function renderLeaderboard(players: LeaderboardEntry[], container: HTMLElement): void {
    if (players.length === 0) {
        container.innerHTML = `<p class="hint">${t('leaderboard.empty')}</p>`;
        return;
    }

    const table = document.createElement('table');
    table.className = 'leaderboard-table';

    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    for (const label of [
        '#',
        t('players.col.name'),
        'Elo',
        t('leaderboard.games'),
        t('leaderboard.wins'),
        t('leaderboard.winrate'),
    ]) {
        const th = document.createElement('th');
        th.textContent = label;
        headRow.appendChild(th);
    }
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    for (const p of players) {
        const tr = document.createElement('tr');
        if (p.rank === 1) tr.classList.add('rank-gold');
        else if (p.rank === 2) tr.classList.add('rank-silver');
        else if (p.rank === 3) tr.classList.add('rank-bronze');

        if (state.user?.player_id && p.player_id === state.user.player_id) {
            tr.classList.add('is-me');
        }

        const tdRank = document.createElement('td');
        tdRank.textContent = String(p.rank);
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

        const tdElo = document.createElement('td');
        tdElo.className = 'elo-cell';
        tdElo.textContent = String(p.elo);
        tr.appendChild(tdElo);

        const tdGames = document.createElement('td');
        tdGames.textContent = String(p.games_played);
        tr.appendChild(tdGames);

        const tdWins = document.createElement('td');
        tdWins.textContent = String(p.wins);
        tr.appendChild(tdWins);

        const tdWinrate = document.createElement('td');
        tdWinrate.textContent = `${p.winrate}%`;
        tr.appendChild(tdWinrate);

        tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    container.innerHTML = '';
    container.appendChild(table);
}