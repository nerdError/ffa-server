import { apiRequest } from '../api';
import { state } from '../state';
import { STAT_KEYS, type PlayerWithStats, type PlayersListResponse } from '../types';

import terranIcon from '../../assets/race/terran.svg';
import zergIcon from '../../assets/race/zerg.svg';
import protossIcon from '../../assets/race/protoss.svg';
import type { Race } from '../types';

const RACE_ICON_URL: Record<Race, string> = {
  T: terranIcon,
  Z: zergIcon,
  P: protossIcon,
};

const RACE_TITLES: Record<Race, string> = {
  T: 'Terran',
  Z: 'Zerg',
  P: 'Protoss',
};

function fmtStat(value: number | null): string {
  if (value === null || value === undefined) return '—';
  return Number(value).toFixed(2);
}

/**
 * Возвращает <span> для значения стата.
 * ВАЖНО: всегда возвращает HTMLElement, даже если данных нет.
 */
function statPill(value: number | null): HTMLSpanElement {
  const span = document.createElement('span');
  if (value === null || value === undefined) {
    span.className = 'stat-pill stat-empty';
    span.textContent = '—';
    return span;
  }
  const rounded = Math.round(Number(value));
  span.className = `stat-pill stat-${Math.min(5, Math.max(1, rounded))}`;
  span.textContent = fmtStat(value);
  return span;
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
    renderPlayersTable(players, cb);
  } catch (err) {
    errBox.textContent =
      'Не удалось загрузить игроков: ' +
      (err instanceof Error ? err.message : String(err));
    errBox.classList.remove('hidden');
    tbody.innerHTML = '';
  }
}

function renderPlayersTable(
  players: PlayerWithStats[],
  cb: PlayersCallbacks
): void {
  const tbody = document.getElementById('players-tbody');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (players.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9">Пока нет игроков.</td></tr>';
    return;
  }

  for (const p of players) {
    const tr = document.createElement('tr');

    const tdName = document.createElement('td');
    const link = document.createElement('a');
    link.className = 'player-name-link';
    link.textContent = p.name;
    link.href = '#';
    link.addEventListener('click', (e) => {
      e.preventDefault();
      cb.onOpenPlayer(p.id);
    });
    tdName.appendChild(link);
    tr.appendChild(tdName);

const tdRaces = document.createElement('td');
tdRaces.className = 'races-cell';
if (p.races.length > 0) {
  for (const r of p.races) {
    const img = document.createElement('img');
    img.src = RACE_ICON_URL[r];
    img.alt = RACE_TITLES[r];
    img.title = RACE_TITLES[r];
    img.className = `race-icon race-icon-${r}`;
    tdRaces.appendChild(img);
  }
} else {
  tdRaces.textContent = '—';
}
tr.appendChild(tdRaces);

    const tdVotes = document.createElement('td');
    tdVotes.textContent = String(p.vote_count);
    tr.appendChild(tdVotes);

    for (const key of STAT_KEYS) {
      const td = document.createElement('td');
      td.appendChild(statPill(p[key]));
      tr.appendChild(td);
    }

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