import { ru } from './ru';
import { en } from './en';
import type { TranslationKey } from './types';
import { FunctionRegion } from '@supabase/supabase-js';

export type Locale = 'ru' | 'en';

const STORAGE_KEY = 'locale';
const DEFAULT_LOCALE: Locale = 'ru';

const dictionaries: Record<Locale, Record<TranslationKey, string>> = {
    ru,
    en,
};

function detectLocale(): Locale {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'ru' || saved === 'en') return saved;

    const browser = navigator.language.toLowerCase();
    if (browser.startsWith('en')) return 'en';
    if (browser.startsWith('ru')) return 'ru';

    return DEFAULT_LOCALE;
}

let currentLocale: Locale = detectLocale();

export function getLocale(): Locale {
    return currentLocale;
}

export function setLocale(locale: Locale): void {
    currentLocale = locale;
    localStorage.setItem(STORAGE_KEY, locale);
    document.documentElement.lang = locale;
    window.dispatchEvent(new CustomEvent('i18n:changed', { detail: { locale } }));
}

export function t(
    key: TranslationKey,
    params?: Record<string, string | number>
): string {
    const dict = dictionaries[currentLocale];
    let str = dict[key] ?? dictionaries.ru[key] ?? key;

    if (params) {
        for (const [k, v] of Object.entries(params)) {
            str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
        }
    }

    return str;
}

export function onLocaleChange(cb: (locale: Locale) => void): () => void {
    const handler = (e: Event) => {
        const detail = (e as CustomEvent<{ locale: Locale }>).detail;
        cb(detail.locale);
    };
    window.addEventListener('i18n:changed', handler);
    return () => window.removeEventListener('i18n:changed', handler);
}

/**
 * Применяет переводы ко всем элементам с атрибутами data-i18n*.
 * Вызывать при старте и при смене языка.
 */
export function applyTranslations(root: ParentNode = document): void {
    // Текстовое содержимое
    root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
        const key = el.dataset.i18n as TranslationKey | undefined;
        if (key) el.textContent = t(key);
    });

    // root.querySelectorAll<HTMLLabelElement>('[data-i18n-rep]').forEach((el) => {
    //     const key = el.dataset["i18nRep"] as TranslationKey | undefined;
    //     if (key) {
    //         el.textContent = el.textContent.replaceAll(key, t(key)); 
    //     }
    // });

    // Placeholder
    root.querySelectorAll<HTMLElement>('[data-i18n-placeholder]').forEach((el) => {
        const key = el.dataset.i18nPlaceholder as TranslationKey | undefined;
        if (key && el instanceof HTMLInputElement) {
            el.placeholder = t(key);
        }
    });

    // title
    root.querySelectorAll<HTMLElement>('[data-i18n-title]').forEach((el) => {
        const key = el.dataset.i18nTitle as TranslationKey | undefined;
        if (key) el.title = t(key);
    });

    // aria-label
    root.querySelectorAll<HTMLElement>('[data-i18n-aria-label]').forEach((el) => {
        const key = el.dataset.i18nAriaLabel as TranslationKey | undefined;
        if (key) el.setAttribute('aria-label', t(key));
    });
}

/**
 * Утилита для склонений. Для английского — всегда forms[2] (множественное).
 */
export function pluralize(
    count: number,
    forms: [string, string, string]
): string {
    if (currentLocale === 'en') {
        return count === 1 ? forms[0] : forms[2];
    }

    // Русские правила
    const n = Math.abs(count) % 100;
    const n1 = n % 10;
    if (n > 10 && n < 20) return forms[2];
    if (n1 > 1 && n1 < 5) return forms[1];
    if (n1 === 1) return forms[0];
    return forms[2];
}