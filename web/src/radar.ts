import type { PlayerWithStats, Race, StatKey } from './types';

export interface StatAxis {
  key: StatKey;
  short: string;
  ru: string;
}

export interface StatAxis {
  key: StatKey;
  ru: string;
  short: string;
  color: string; // hex
}

export const STAT_ORDER: readonly StatAxis[] = [
  { key: 'adaptiveness', ru: 'Адаптивность', short: 'Адапт.',    color: '#e67e22' },
  { key: 'aggression',   ru: 'Агрессия',     short: 'Агресс.',   color: '#e74c3c' },
  { key: 'turtle',       ru: 'Черепашность', short: 'Черепаха',  color: '#2ecc71' },
  { key: 'variety',      ru: 'Разнообразие', short: 'Разнообр.', color: '#9b59b6' },
  { key: 'survival',     ru: 'Выживание',    short: 'Выжив.',    color: '#3498db' },
  { key: 'greed',        ru: 'Халява',       short: 'Халява',    color: '#f1c40f' },
] as const;

const LEVEL_LETTERS: Record<number, string> = {
  1: 'E', 2: 'D', 3: 'C', 4: 'B', 5: 'A',
};

const RACE_COLORS: Record<Race | 'MIXED', string> = {
  T: '#3498db', // Terran — синий
  Z: '#9b59b6', // Zerg — фиолетовый
  P: '#f1c40f', // Protoss — жёлтый
  MIXED: '#95a5a6', // серый — «смешанный»
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
}

export function buildRadarSVG(opts: RadarOptions): string {
  const { stats, color, size = 480, maxLevel = 5 } = opts;
  const cx = size / 2;
  const cy = size / 2;
  const R = size * 0.36;
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
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" preserveAspectRatio="xMidYMid meet">`
  );

  parts.push(`
    <defs>
      <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="5" result="blur"/>
        <feMerge>
          <feMergeNode in="blur"/>
          <feMergeNode in="SourceGraphic"/>
        </feMerge>
      </filter>
      <radialGradient id="fillGradient" cx="50%" cy="50%" r="50%">
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

  // Оси + подписи в цвете параметра
  for (let i = 0; i < n; i++) {
    const axis = STAT_ORDER[i];
    if (!axis) continue;
    const angle = startAngle + i * angleStep;
    const [x, y] = point(angle, R);

    // Линия оси — приглушённый цвет параметра
    parts.push(
      `<line x1="${cx}" y1="${cy}" x2="${x.toFixed(2)}" y2="${y.toFixed(2)}"
        stroke="${axis.color}" stroke-opacity="0.25" stroke-width="1" />`
    );

    const [lx, ly] = point(angle, R + 30);
    const anchor = Math.abs(lx - cx) < 2 ? 'middle' : lx > cx ? 'start' : 'end';
    const dy = ly < cy - 5 ? '-6' : ly > cy + 5 ? '14' : '4';

    parts.push(
      `<text x="${lx.toFixed(2)}" y="${ly.toFixed(2)}" fill="${axis.color}"
        font-family="Rajdhani, sans-serif" font-size="13" font-weight="700"
        letter-spacing="1" text-anchor="${anchor}" dy="${dy}">
        ${axis.ru.toUpperCase()}
      </text>`
    );
  }

  // Буквы уровней
  const labelAngle = startAngle - 0.18;
  for (let level = 1; level <= maxLevel; level++) {
    const r = level * stepR;
    const [x, y] = point(labelAngle, r);
    parts.push(
      `<text x="${x.toFixed(2)}" y="${y.toFixed(2)}" fill="#556677"
        font-family="Rajdhani, sans-serif" font-size="10" font-weight="700"
        text-anchor="middle" dy="3">${LEVEL_LETTERS[level] ?? '?'}</text>`
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
        fill="url(#fillGradient)"
        stroke="${color}" stroke-width="2.5"
        stroke-linejoin="round"
        filter="url(#glow)" />`
    );
    // Точки — каждая в цвете своей оси
    STAT_ORDER.forEach((axis, i) => {
      const pt = dataPoints[i];
      if (!pt) return;
      const [x, y] = pt;
      parts.push(
        `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="4.5"
          fill="${axis.color}" stroke="#0a0c10" stroke-width="1.5" />`
      );
    });
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