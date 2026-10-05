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

onLocaleChange(() => {
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

/**
 * Создаёт DOM-элемент карточки игрока.
 * Работает быстро: SVG радара — строка, иконки — обычные <img>.
 *
 * @param player — данные игрока
 * @param opts.compact — «компактный» режим для OBS (на весь экран, без фона)
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

    // ============================================================
    // Шапка: иконка + ник + aka + раса
    // ============================================================
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
    if (player.aka) {
        const akaEl = document.createElement('span');
        akaEl.className = 'pc-aka';
        akaEl.textContent = ` aka ${player.aka}`;
        nameEl.appendChild(akaEl);
    }

    const raceEl = document.createElement('div');
    raceEl.className = 'pc-race';
    raceEl.textContent =
        RACE_NAMES[race].toUpperCase() +
        (player.races.length > 1 ? ` · ${player.races.join(' / ')}` : '');

    titleBlock.append(nameEl, raceEl);
    header.appendChild(titleBlock);

    card.appendChild(header);

    // ============================================================
    // Тело: радар + легенда
    // ============================================================
    const body = document.createElement('div');
    body.className = 'pc-body';

    const radarWrap = document.createElement('div');
    radarWrap.className = 'pc-radar';
    radarWrap.innerHTML = buildRadarSVG({
        stats: player,
        color,
        size: 500,
        uniqueId: `player-${player.id}`,
        showVertices: false,
    });
    body.appendChild(radarWrap);

    const legend = document.createElement('div');
    legend.className = 'pc-legend';
    for (const axis of STAT_ORDER) {
        const value = player[axis.key];
        const row = document.createElement('div');
        row.className = 'pc-legend-row';
        row.style.setProperty('--stat-color', axis.color);

        const label = document.createElement('span');
        label.className = 'pc-legend-label pc-legend-name';
        label.textContent = t(axis.langKey);

        const bar = document.createElement('div');
        bar.className = 'pc-legend-bar';
        const fill = document.createElement('div');
        fill.className = 'pc-legend-bar-fill';
        if (typeof value === 'number') {
            const pct = Math.max(0, Math.min(100, ((value - 1) / 4) * 80 + 20));
            fill.style.width = `${pct}%`;
        } else {
            fill.style.width = '0%';
        }
        bar.appendChild(fill);

        const grade = document.createElement('span');
        grade.className = 'pc-legend-grade';
        if (typeof value === 'number') {
            grade.textContent = LEVEL_LETTERS[Math.round(value)] ?? '?';
        } else {
            grade.textContent = '—';
            grade.classList.add('pc-legend-grade--empty');
        }

        row.append(label, bar, grade);
        legend.appendChild(row);
    }
    body.appendChild(legend);

    card.appendChild(body);

    // ============================================================
    // Нижняя панель метрик
    // ============================================================
    const metricsBar = document.createElement('div');
    metricsBar.className = 'pc-metrics-bar';

    // Активность — главная метрика
    const activityValue = player.games_played > 0
        ? player.activity_score.toFixed(1)
        : '—';
    const activityMetric = document.createElement('div');
    activityMetric.className = 'pc-metric pc-metric--activity';
    const activityRank = player.activity_rank !== null
        ? `#${player.activity_rank}`
        : '';
    activityMetric.innerHTML = `
  <div class="pc-metric-value">${activityValue}</div>
  <div class="pc-metric-label">
    ${escapeHtml(t('leaderboard.activity'))}
    ${activityRank ? `<span class="pc-metric-rank">${activityRank}</span>` : ''}
  </div>
`;
    metricsBar.appendChild(activityMetric);

    // Игр
    metricsBar.appendChild(buildMetric(
        t('leaderboard.games'),
        String(player.games_played),
        'games',
    ));

    // Побед
    metricsBar.appendChild(buildMetric(
        t('leaderboard.wins'),
        String(player.wins),
        player.wins > 0 ? 'win' : 'muted',
    ));

    // Winrate
    const winrateLevel =
        player.winrate >= 30 ? 'win' :
            player.winrate >= 10 ? 'mid' :
                'muted';
    metricsBar.appendChild(buildMetric(
        t('leaderboard.winrate'),
        `${player.winrate}%`,
        winrateLevel,
    ));

    // Среднее место
    metricsBar.appendChild(buildMetric(
        t('leaderboard.avg_place'),
        player.avg_place !== null ? player.avg_place.toFixed(2) : '—',
        player.avg_place !== null ? 'mid' : 'muted',
    ));

    // ELO — отделённая метрика
    const eloMetric = document.createElement('div');
    eloMetric.className = 'pc-metric pc-metric--elo';
    const eloRank = player.elo_rank !== null ? `#${player.elo_rank}` : '';
    eloMetric.innerHTML = `
  <div class="pc-metric-value">${player.elo}</div>
  <div class="pc-metric-label">
    ELO
    ${eloRank ? `<span class="pc-metric-rank">${eloRank}</span>` : ''}
  </div>
`;
    metricsBar.appendChild(eloMetric);

    card.appendChild(metricsBar);

    return card;
}

function buildMetric(label: string, value: string, modifier: string): HTMLElement {
    const el = document.createElement('div');
    el.className = `pc-metric pc-metric--${modifier}`;
    el.innerHTML = `
    <div class="pc-metric-value">${escapeHtml(value)}</div>
    <div class="pc-metric-label">${escapeHtml(label)}</div>
  `;
    return el;
}

function escapeHtml(str: string): string {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
