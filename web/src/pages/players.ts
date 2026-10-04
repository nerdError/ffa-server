import { apiRequest } from '../api';
import { bindCreatePlayer, findPlayerByName, loadPlayers } from '../ui/players';
import { openPlayerScreen } from '../ui/player-detail';
import type { PlayersListResponse } from '../types';
import { navigateTo } from '../router';

let mounted = false;

export function mountPlayers(params: URLSearchParams): void {
    const backBtn = document.getElementById('btn-back');
    if (backBtn) {
        // Клонируем кнопку, чтобы снять все старые обработчики (на случай
        // повторного монтирования роута)
        const freshBtn = backBtn.cloneNode(true) as HTMLElement;
        backBtn.replaceWith(freshBtn);
        freshBtn.addEventListener('click', () => {
            navigateTo('/', true);
        });
    }

    bindCreatePlayer(() => {
        // После создания — перезагружаем список
        void loadPlayers({
            onOpenPlayer: (id, name) => {
                window.history.pushState({}, '', `/?player=${encodeURIComponent(name)}`);
                void openPlayerScreen(id);
            },
        });
    });

    const screen = document.getElementById('screen-players');
    const playerScreen = document.getElementById('screen-player');
    if (screen) screen.classList.remove('hidden');
    if (playerScreen) playerScreen.classList.add('hidden');

    // 2. Потом обрабатываем ?player=
    const playerParam = params.get('player');
    if (playerParam) {
        // Есть параметр — сразу открываем карточку, БЕЗ показа списка
        void openPlayerFromParam(playerParam);
        return;
    }

    // Показываем список игроков
    if (screen) screen.classList.remove('hidden');
    if (playerScreen) playerScreen.classList.add('hidden');

    void loadPlayers({
        onOpenPlayer: (id, name) => {
            history.pushState({}, '', `/?player=${encodeURIComponent(name)}`);
            void openPlayerScreen(id);
        },
    });

    mounted = true;
}

export function unmountPlayers(): void {
    mounted = false;
}

async function openPlayerFromParam(param: string): Promise<void> {
    const trimmed = param.trim();
    const asNumber = Number(trimmed);

    if (Number.isInteger(asNumber) && asNumber > 0) {
        void openPlayerScreen(asNumber);
        return;
    }

    // Сначала пробуем кэш
    const cached = findPlayerByName(trimmed);
    if (cached) {
        void openPlayerScreen(cached.id);
        return;
    }

    try {
        const res = await apiRequest<PlayersListResponse>('/api/players');
        const found = res.players.find(
            (p) => p.name.toLowerCase() === trimmed.toLowerCase()
        );
        if (found) {
            void openPlayerScreen(found.id);
        } else {
            // не нашли — показываем список
            const screen = document.getElementById('screen-players');
            if (screen) screen.classList.remove('hidden');
            void loadPlayers({ onOpenPlayer: () => { } });
        }
    } catch {
        const screen = document.getElementById('screen-players');
        if (screen) screen.classList.remove('hidden');
    }
}