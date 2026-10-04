/**
 * Простой SPA-роутер.
 */

import { t } from "./i18n";

export interface RouteHandler {
    mount: (params: URLSearchParams) => void | Promise<void>;
    unmount?: () => void;
}

interface RouteDefinition {
    path: string;
    handler: RouteHandler;
}

const routes: RouteDefinition[] = [];
let notFoundHandler: RouteHandler | null = null;
let currentRoute: RouteDefinition | null = null;

function normalizePath(path: string): string {
    let p = path.trim();
    if (!p.startsWith('/')) p = '/' + p;
    if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
    return p;
}

export function registerRoute(path: string, handler: RouteHandler): void {
    routes.push({ path: normalizePath(path), handler });
}

export function setNotFoundHandler(handler: RouteHandler): void {
    notFoundHandler = handler;
}

function matchRoute(pathname: string): RouteDefinition | null {
    const normalized = normalizePath(pathname);
    return routes.find((r) => r.path === normalized) ?? null;
}

export function navigateTo(url: string, replace = false): void {
    const target = new URL(url, window.location.origin);
    const fullUrl = target.pathname + target.search + target.hash;

    if (replace) {
        history.replaceState({}, '', fullUrl);
    } else {
        history.pushState({}, '', fullUrl);
    }

    void handleRoute();
}

async function handleRoute(): Promise<void> {
    const pathname = window.location.pathname;
    const search = new URLSearchParams(window.location.search);

    window.scrollTo(0, 0);

    // Скрываем все секции
    document.querySelectorAll<HTMLElement>('.screen').forEach((el) => {
        el.classList.add('hidden');
    });

    // Unmount предыдущей страницы
    if (currentRoute?.handler.unmount) {
        try {
            currentRoute.handler.unmount();
        } catch (err) {
            console.error('[router] unmount error:', err);
        }
    }

    const route = matchRoute(pathname);

    if (route) {
        currentRoute = route;
        try {
            await route.handler.mount(search);
        } catch (err) {
            console.error('[router] mount error:', err);
        }
    } else if (notFoundHandler) {
        currentRoute = { path: pathname, handler: notFoundHandler };
        try {
            await notFoundHandler.mount(search);
        } catch (err) {
            console.error('[router] not-found error:', err);
        }
    } else {
        console.warn('[router] no route for', pathname);
    }

    updateActiveNav(pathname);
    updateTitle(pathname);
}

function updateActiveNav(pathname: string): void {
    const section = pathnameToSection(pathname);
    document.querySelectorAll<HTMLElement>('.site-nav-link').forEach((link) => {
        link.classList.toggle('is-active', link.dataset.nav === section);
    });
}

function pathnameToSection(pathname: string): string {
    if (pathname === '/games') return 'games';
    if (pathname === '/control') return 'control';
    if (pathname === '/admin') return 'admin';
    if (pathname === '/leaderboard') return 'leaderboard';
    return 'players';
}

function setupLinkInterception(): void {
    document.addEventListener('click', (e) => {
        if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
        if (e.button !== 0) return;

        const link = (e.target as HTMLElement).closest('a');
        if (!link) return;
        if (link.target === '_blank') return;
        if (link.host !== location.host) return;
        if (!link.href.startsWith(location.origin)) return;
        if (link.hasAttribute('download')) return;

        const url = new URL(link.href);

        if (url.pathname === location.pathname && url.search === location.search) {
            if (url.hash) return;
            e.preventDefault();
            return;
        }

        if (url.pathname === location.pathname && url.hash) return;

        e.preventDefault();
        navigateTo(url.toString());
    });
}

export function initRouter(): void {
    setupLinkInterception();

    window.addEventListener('popstate', () => {
        void handleRoute();
    });

    void handleRoute();
}

export function updateTitle(pathname: string = window.location.pathname): void {
    const section = pathnameToSection(pathname);
    const titles: Record<string, string> = {
        players: 'players.title',
        games: 'games.title',
        control: 'control.title',
        admin: 'admin.title',
        leaderboard: 'leaderboard.title',
    };
    const key = titles[section];
    if (key) {
        document.title = `${t(key as any)} — SC2 FFA League`;
    }
}