import type { PlayerWithStats, Race } from './types';
import { STAT_ORDER, buildRadarSVG, pickRaceColor } from './radar';

// Импортируем SVG как URL — Vite отдаст путь к файлу.
// <img src="..."> закэшируется браузером и будет рендериться мгновенно.
import terranIconUrl from '../assets/race/terran.svg';
import zergIconUrl from '../assets/race/zerg.svg';
import protossIconUrl from '../assets/race/protoss.svg';

const RACE_ICON_URL: Record<Race, string> = {
  T: terranIconUrl,
  Z: zergIconUrl,
  P: protossIconUrl,
};

const RACE_NAMES: Record<Race | 'MIXED', string> = {
  T: 'Terran',
  Z: 'Zerg',
  P: 'Protoss',
  MIXED: 'Mixed',
};

const LEVEL_LETTERS: Record<number, string> = {
  1: 'E', 2: 'D', 3: 'C', 4: 'B', 5: 'A',
};

function dominantRace(races: Race[]): Race | 'MIXED' {
  if (races.length === 0) return 'MIXED';
  if (races.length === 1) return races[0] ?? 'MIXED';
  return 'MIXED';
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Создаёт DOM-элемент карточки игрока.
 * Работает быстро: SVG радара — строка, иконки — обычные <img>.
 *
 * @param player — данные игрока
 * @param opts.compact — «компактный» режим для OBS (меньше отступы, крупнее радар)
 */
export function buildPlayerCardElement(
  player: PlayerWithStats,
  opts: { compact?: boolean } = {}
): HTMLElement {
  const { compact = false } = opts;

  const race = dominantRace(player.races);
  const color = pickRaceColor(player.races);

  const card = document.createElement('div');
  card.className = `player-card${compact ? ' player-card--compact' : ''}`;
  card.style.setProperty('--race-color', color);

  // --- Шапка ---
  const header = document.createElement('div');
  header.className = 'pc-header';

  const iconBox = document.createElement('div');
  iconBox.className = 'pc-icon-box';
  if (race !== 'MIXED') {
    const img = document.createElement('img');
    img.src = RACE_ICON_URL[race];
    img.alt = RACE_NAMES[race];
    img.className = 'pc-icon';
    iconBox.appendChild(img);
  } else {
    iconBox.innerHTML = '<div class="pc-icon-mixed">◆</div>';
  }
  header.appendChild(iconBox);

  const titleBlock = document.createElement('div');
  titleBlock.className = 'pc-title-block';
  const nameEl = document.createElement('div');
  nameEl.className = 'pc-name';
  nameEl.textContent = player.name;
  const raceEl = document.createElement('div');
  raceEl.className = 'pc-race';
  raceEl.textContent = RACE_NAMES[race].toUpperCase() +
    (player.races.length > 1 ? ` · ${player.races.join(' / ')}` : '');
  titleBlock.append(nameEl, raceEl);
  header.appendChild(titleBlock);

  const votesBlock = document.createElement('div');
  votesBlock.className = 'pc-votes';
  const votesLabel = document.createElement('div');
  votesLabel.className = 'pc-votes-label';
  votesLabel.textContent = 'ГОЛОСОВ';
  const votesCount = document.createElement('div');
  votesCount.className = 'pc-votes-count';
  votesCount.textContent = String(player.vote_count);
  votesBlock.append(votesLabel, votesCount);
  header.appendChild(votesBlock);

  card.appendChild(header);

  // --- Тело: радар слева, легенда справа ---
  const body = document.createElement('div');
  body.className = 'pc-body';

  const radarWrap = document.createElement('div');
  radarWrap.className = 'pc-radar';
  radarWrap.innerHTML = buildRadarSVG({ stats: player, color, size: 380 });
  body.appendChild(radarWrap);

  const legend = document.createElement('div');
  legend.className = 'pc-legend';
  for (const axis of STAT_ORDER) {
    const value = player[axis.key];
    const row = document.createElement('div');
    row.className = 'pc-legend-row';
    row.style.setProperty('--stat-color', axis.color);

    const label = document.createElement('span');
    label.className = 'pc-legend-label';
    label.textContent = axis.short; // короткое имя, чтобы влезало

    const valueEl = document.createElement('span');
    valueEl.className = 'pc-legend-value';
    if (typeof value === 'number') {
      const letter = LEVEL_LETTERS[Math.round(value)] ?? '?';
      valueEl.textContent = `${value.toFixed(2)} · ${letter}`;
    } else {
      valueEl.textContent = '—';
      valueEl.classList.add('pc-legend-value--empty');
    }

    row.append(label, valueEl);
    legend.appendChild(row);
  }
  body.appendChild(legend);

  card.appendChild(body);

  return card;
}