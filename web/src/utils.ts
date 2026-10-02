import { getLocale } from "./i18n";

/**
 * Карта транслитерации: русская буква (в нижнем регистре) → латиница.
 */
const TRANSLIT_MAP: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "yo",
  ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m",
  н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u",
  ф: "f", х: "kh", ц: "ts", ч: "ch", ш: "sh", щ: "shch",
  ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};

/**
 * Применяет регистр оригинала к результату замены:
 * - если оригинал в верхнем регистре → результат в верхнем;
 * - если в нижнем → результат в нижнем.
 */
function applyCase(original: string, replacement: string): string {
  if (!replacement) return "";
  // Проверяем, что символ в верхнем регистре (и при этом это буква)
  if (original === original.toUpperCase() && original !== original.toLowerCase()) {
    return replacement.toUpperCase();
  }
  return replacement.toLowerCase();
}

/**
 * Транслитерирует русский текст в латиницу с сохранением регистра.
 */
export function transliterate(input: string): string {
  if (!input) return "";

  let result = "";
  for (const char of input) {
    const lower = char.toLowerCase();
    const replacement = TRANSLIT_MAP[lower];

    if (replacement !== undefined) {
      result += applyCase(char, replacement);
    } else {
      // Символ не из русского алфавита — оставляем как есть
      result += char;
    }
  }
  return result;
}

/**
 * Транслитерирует ник: сохраняет регистр,
 * удаляет недопустимые для ника символы.
 */
export function transliterateNickname(input: string): string {
  const transliterated = transliterate(input);
  return transliterated.replace(/[^a-zA-Z0-9_-]/g, "");
}

export function getLocalePlayerName(name: string): string {
    if (getLocale() == 'en') {
        name = transliterate(name);
    }

    return name;
}