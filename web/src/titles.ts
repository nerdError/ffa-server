// ============================================================
// Фиксированная палитра цветов титулов (под тёмную SC2-тему).
// Используется в админке (выбор) и в карточке игрока.
// ============================================================

export interface TitleColor {
  /** HEX-значение, хранится в БД (titles.color) */
  value: string;
  /** i18n-ключ названия цвета */
  nameKey: string;
}

export const TITLE_COLORS: readonly TitleColor[] = [
  { value: '#c9a227', nameKey: 'title.color_gold' },   // золото (акцент сайта)
  { value: '#4b9fe3', nameKey: 'title.color_blue' },   // терран
  { value: '#9b59d0', nameKey: 'title.color_purple' }, // зерг
  { value: '#f1c40f', nameKey: 'title.color_yellow' }, // протосс
  { value: '#95a5a6', nameKey: 'title.color_gray' },   // рандом
  { value: '#e05a5a', nameKey: 'title.color_red' },
  { value: '#2ecc71', nameKey: 'title.color_green' },
  { value: '#39c2d0', nameKey: 'title.color_cyan' },
  { value: '#e8863a', nameKey: 'title.color_orange' },
  { value: '#d06bb3', nameKey: 'title.color_pink' },
];

/** Находит цвет из палитры по HEX (для рендера карточки). */
export function isTitleColor(value: string): boolean {
  return TITLE_COLORS.some((c) => c.value.toLowerCase() === value.toLowerCase());
}