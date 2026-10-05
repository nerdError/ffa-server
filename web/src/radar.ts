import { applyTranslations, onLocaleChange, t } from './i18n';
import { TranslationKey } from './i18n/types';
import type { PlayerWithStats, Race, StatKey } from './types';

applyTranslations();

onLocaleChange(() => {
    applyTranslations();
});

export interface StatAxis {
    key: StatKey;
    langKey: TranslationKey;
    getStr: () => string;
    color: string;
}

export const STAT_ORDER: readonly StatAxis[] = [
    { key: 'adaptiveness', getStr: () => t('stat.adaptiveness'), langKey: 'stat.adaptiveness', color: '#e67e22' },
    { key: 'aggression', getStr: () => t('stat.aggression'), langKey: 'stat.aggression', color: '#e74c3c' },
    { key: 'turtle', getStr: () => t('stat.turtle'), langKey: 'stat.turtle', color: '#2ecc71' },
    { key: 'variety', getStr: () => t('stat.variety'), langKey: 'stat.variety', color: '#9b59b6' },
    { key: 'survival', getStr: () => t('stat.survival'), langKey: 'stat.survival', color: '#3498db' },
    { key: 'greed', getStr: () => t('stat.greed'), langKey: 'stat.greed', color: '#f1c40f' },
] as const;

const RACE_COLORS: Record<Race | 'MIXED', string> = {
    T: '#3498db',  // Terran — синий
    Z: '#9b59b6',  // Zerg — фиолетовый
    P: '#f1c40f',  // Protoss — жёлтый
    R: '#95a5a6',  // Random — серый (тот же, что MIXED)
    MIXED: '#95a5a6',
};
export function pickRaceColor(races: Race[]): string {
    if (races.length === 0) return RACE_COLORS.MIXED;
    if (races.length === 1) {
        const r = races[0];
        return r ? RACE_COLORS[r] : RACE_COLORS.MIXED;
    }
    return RACE_COLORS.MIXED;
}

interface RadarOptions {
    stats: Pick<PlayerWithStats, StatKey>;
    color: string;
    size?: number;
    maxLevel?: number;
    uniqueId?: string;   // ← НОВОЕ
    showVertices?: boolean;
}

export let lastRadarOptions: RadarOptions | null = null;

export function buildRadarSVG(opts: RadarOptions): string {
    const { stats, color, size = 480, maxLevel = 5, uniqueId, showVertices } = opts;
    lastRadarOptions = opts;

    // Уникальный суффикс для id внутри этого SVG
    const uid = uniqueId ?? `r${Math.random().toString(36).slice(2, 9)}`;
    const glowId = `glow-${uid}`;
    const gradId = `fillGradient-${uid}`;

    const cx = size / 2;
    const cy = size / 2;
    const R = size * 0.32;              // чуть меньше радиус — освобождаем место подписям
    const stepR = R / maxLevel;
    const n = STAT_ORDER.length;
    const angleStep = (2 * Math.PI) / n;
    const startAngle = -Math.PI / 2;

    const point = (angle: number, radius: number): [number, number] => [
        cx + radius * Math.cos(angle),
        cy + radius * Math.sin(angle),
    ];

    const parts: string[] = [];
    parts.push(
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" preserveAspectRatio="xMidYMid meet" overflow="visible">`
    );

    parts.push(`
    <defs>
      <filter id="${glowId}" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="5" result="blur"/>
        <feMerge>
          <feMergeNode in="blur"/>
          <feMergeNode in="SourceGraphic"/>
        </feMerge>
      </filter>
      <radialGradient id="${gradId}" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stop-color="${color}" stop-opacity="0.45"/>
        <stop offset="100%" stop-color="${color}" stop-opacity="0.10"/>
      </radialGradient>
    </defs>
  `);

    // Кольца уровней
    for (let level = 1; level <= maxLevel; level++) {
        const r = level * stepR;
        const pts = Array.from({ length: n }, (_, i) => {
            const [x, y] = point(startAngle + i * angleStep, r);
            return `${x.toFixed(2)},${y.toFixed(2)}`;
        }).join(' ');
        const isOuter = level === maxLevel;
        parts.push(
            `<polygon points="${pts}" fill="none"
        stroke="${isOuter ? '#3a4a5a' : '#2a3a4a'}"
        stroke-width="${isOuter ? 1.5 : 1}" />`
        );
    }

    // Оси
    for (let i = 0; i < n; i++) {
        const axis = STAT_ORDER[i];
        if (!axis) continue;
        const angle = startAngle + i * angleStep;
        const [x, y] = point(angle, R);
        parts.push(
            `<line x1="${cx}" y1="${cy}" x2="${x.toFixed(2)}" y2="${y.toFixed(2)}"
        stroke="${axis.color}" stroke-opacity="0.25" stroke-width="1" />`
        );
    }

    // Подписи осей — радиально наружу, с сохранением читаемости
    for (let i = 0; i < n; i++) {
        const axis = STAT_ORDER[i];
        if (!axis) continue;

        const angle = startAngle + i * angleStep;

        const text = axis.getStr().toUpperCase();
        const fontSize = text.length >= 13 ? 10 : text.length >= 10 ? 11 : 12;

        // Отступ от кольца: половина длины текста + запас,
        // чтобы буквы не заходили внутрь радара
        const estimatedWidth = text.length * fontSize * 0.35;
        const offset = estimatedWidth / 2 + 4;
        const [lx, ly] = point(angle, R + offset);

        // Угол текста: перпендикулярно лучу, «смотря наружу»
        let angleDeg = (angle * 180) / Math.PI + 90;

        // Нормализуем в диапазон [−180, 180]
        while (angleDeg > 180) angleDeg -= 360;
        while (angleDeg < -180) angleDeg += 360;

        // На нижней половине текст перевернулся бы вверх ногами — разворачиваем
        if (angleDeg > 90 || angleDeg < -90) {
            angleDeg += 180;
            while (angleDeg > 180) angleDeg -= 360;
            while (angleDeg < -180) angleDeg += 360;
        }

        parts.push(
            `<text
      transform="translate(${lx.toFixed(2)}, ${ly.toFixed(2)}) rotate(${angleDeg.toFixed(2)})"
      fill="${axis.color}"
      font-family="Zekton, sans-serif"
      font-size="${fontSize}"
      font-weight="700"
      letter-spacing="0.5"
      text-anchor="middle"
      dominant-baseline="middle">
      ${text}
    </text>`
        );
    }

    // Полигон
    const dataPoints = STAT_ORDER.map((axis, i) => {
        const raw = stats[axis.key];
        const value = typeof raw === 'number' && !Number.isNaN(raw) ? raw : 0;
        const angle = startAngle + i * angleStep;
        const r = (Math.max(0, Math.min(maxLevel, value)) / maxLevel) * R;
        return point(angle, r);
    });

    const polygonPoints = dataPoints
        .map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`)
        .join(' ');

    const hasData = STAT_ORDER.some((a) => typeof stats[a.key] === 'number');

    if (hasData) {
        parts.push(
            `<polygon points="${polygonPoints}"
    fill="url(#${gradId})"
    stroke="${color}" stroke-width="2.5"
    stroke-linejoin="round"
    filter="url(#${glowId})" />`
        );
        if (showVertices !== false) {
            STAT_ORDER.forEach((axis, i) => {
                const pt = dataPoints[i];
                if (!pt) return;
                const [x, y] = pt;
                parts.push(
                    `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="4"
          fill="${axis.color}" stroke="#0a0c10" stroke-width="1.5" />`
                );
            });
        }
    } else {
        parts.push(
            `<polygon points="${polygonPoints}"
        fill="none" stroke="#3a4a5a" stroke-width="1.5"
        stroke-dasharray="6 4" />`
        );
    }

    parts.push('</svg>');
    return parts.join('');
}