import type { PlayerWithStats, Race } from './types';
import { STAT_ORDER, buildRadarSVG, pickRaceColor } from './radar';

// Импортируем SVG как URL — Vite отдаст путь к файлу.
// <img src="..."> закэшируется браузером и будет рендериться мгновенно.
import terranIconUrl from '../assets/race/terran.svg';
import zergIconUrl from '../assets/race/zerg.svg';
import protossIconUrl from '../assets/race/protoss.svg';
import randomIconUrl from '../assets/race/random.svg';
import { applyTranslations, onLocaleChange, t } from './i18n';
import { getLocalePlayerName } from './utils';

onLocaleChange((locale) => {
    applyTranslations();
});

const RACE_ICON_URL: Record<Race, string> = {
    T: terranIconUrl,
    Z: zergIconUrl,
    P: protossIconUrl,
    R: randomIconUrl,
};

const RACE_NAMES: Record<Race | 'MIXED', string> = {
    T: 'Terran',
    Z: 'Zerg',
    P: 'Protoss',
    R: 'Random',
    MIXED: 'Mixed',
};

const LEVEL_LETTERS: Record<number, string> = {
    1: 'E', 2: 'D', 3: 'C', 4: 'B', 5: 'A',
};

export function dominantRace(races: Race[]): Race | 'MIXED' {
    if (races.length === 0) return 'MIXED';
    if (races.length === 1) return races[0] ?? 'MIXED';
    return 'MIXED';
}

let lastPlayer: PlayerWithStats | null = null;
let lastPlayerOpts: { compact?: boolean } | null = null;

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

    lastPlayer = player;
    lastPlayerOpts = opts;

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
    nameEl.textContent = getLocalePlayerName(player.name, true);

    // aka — если есть
    if (player.aka) {
        const akaEl = document.createElement('span');
        akaEl.className = 'pc-aka';
        akaEl.textContent = ` aka ${player.aka}`;
        nameEl.appendChild(akaEl);
    }
    
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
    votesLabel.dataset.i18n = 'player.votes'
    votesLabel.textContent = t('player.votes');
    const votesCount = document.createElement('div');
    votesCount.className = 'pc-votes-count';
    votesCount.textContent = String(player.vote_count);
    votesBlock.append(votesLabel, votesCount);
    header.appendChild(votesBlock);

    card.appendChild(header);

    // --- Тело: радар слева, легенда справа ---
    const body = document.createElement('div');
    body.className = 'pc-body';

    // --- Радар (левая колонка) ---
    const radarWrap = document.createElement('div');
    radarWrap.className = 'pc-radar';
    radarWrap.innerHTML = buildRadarSVG({ stats: player, color, size: 500 });
    body.appendChild(radarWrap);

    // --- Легенда (правая колонка) ---
    const legend = document.createElement('div');
    legend.className = 'pc-legend';

    // Сортируем: сильные статы сверху, пустые — в конце
    const legendItems = [...STAT_ORDER]
        .map((axis) => ({
            axis,
            value: player[axis.key],
        }))
        .sort((a, b) => {
            const av = typeof a.value === 'number' ? a.value : -1;
            const bv = typeof b.value === 'number' ? b.value : -1;
            return bv - av;
        });

    for (const { axis, value } of legendItems) {
        const row = document.createElement('div');
        row.className = 'pc-legend-row';
        row.style.setProperty('--stat-color', axis.color);

        // Название
        const nameEl = document.createElement('div');
        nameEl.className = 'pc-legend-name';
        nameEl.dataset.i18n = axis.langKey;
        nameEl.textContent = axis.getStr();

        // Полоска заполнения (как у слайдера)
        const barWrap = document.createElement('div');
        barWrap.className = 'pc-legend-bar';
        const barFill = document.createElement('div');
        barFill.className = 'pc-legend-bar-fill';
        if (typeof value === 'number') {
            const pct = Math.max(0, Math.min(100, ((value - 1) / 4) * 80 + 20));
            barFill.style.width = `${pct}%`;
        } else {
            barFill.style.width = '0%';
        }
        barWrap.appendChild(barFill);

        // Буква рейтинга
        const gradeEl = document.createElement('div');
        gradeEl.className = 'pc-legend-grade';
        if (typeof value === 'number') {
            const rounded = Math.round(value);
            gradeEl.textContent = LEVEL_LETTERS[rounded] ?? '?';
        } else {
            gradeEl.textContent = '—';
            gradeEl.classList.add('pc-legend-grade--empty');
        }

        row.append(nameEl, barWrap, gradeEl);
        legend.appendChild(row);
    }

    body.appendChild(legend);
    card.appendChild(body);

    return card;
}