import './styles/main.css';

import { setupApp } from './app';
import { registerRoute, setNotFoundHandler, initRouter } from './router';
import { markPageReady, setupPreloaderFallback } from './navigation';
import { state, saveSession, clearSession } from './state';
import { apiRequest, ApiRequestError } from './api';

import { mountPlayers, unmountPlayers } from './pages/players';
import { mountGames, unmountGames } from './pages/games';
import { mountControl, unmountControl } from './pages/control';
import { mountAdmin, unmountAdmin } from './pages/admin';
import { mountAuth, unmountAuth } from './pages/auth';
import { mountLeaderboard, unmountLeaderboard } from './pages/leaderboard';

async function bootstrap(): Promise<void> {
    setupPreloaderFallback();

    if ('scrollRestoration' in history) {
        history.scrollRestoration = 'manual';
    }

    if (state.token && state.user) {
        try {
            const me = await apiRequest<{
                user: {
                    id: string;
                    email: string;
                    username: string | null;
                    is_moderator: boolean;
                    is_admin: boolean;
                };
            }>('/api/auth/me', { token: state.token });

            saveSession(
                {
                    id: me.user.id,
                    email: me.user.email,
                    username: me.user.username,
                    is_moderator: me.user.is_moderator,
                    is_admin: me.user.is_admin,
                },
                state.token
            );
        } catch (err) {
            if (err instanceof ApiRequestError && err.status === 401) {
                clearSession();
            }
        }
    }

    setupApp();

    registerRoute('/', { mount: mountPlayers, unmount: unmountPlayers });
    registerRoute('/games', { mount: mountGames, unmount: unmountGames });
    registerRoute('/control', { mount: mountControl, unmount: unmountControl });
    registerRoute('/admin', { mount: mountAdmin, unmount: unmountAdmin });
    registerRoute('/auth', { mount: mountAuth, unmount: unmountAuth });
    registerRoute('/leaderboard', {
        mount: mountLeaderboard,
        unmount: unmountLeaderboard,
    });

    setNotFoundHandler({
        mount: () => {
            window.history.replaceState({}, '', '/');
            void mountPlayers(new URLSearchParams());
        },
    });

    initRouter();
    markPageReady();
}

void bootstrap();