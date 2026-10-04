import './styles/main.css';
import './styles/admin.css';
import { apiRequest } from './api';
import { state } from './state';
import type { PlayerWithStats, PlayersListResponse } from './types';

// ============================================================
// Типы
// ============================================================
type Role = 'moderator' | 'admin';

interface AdminUser {
    id: string;
    email: string;
    username: string | null;
    created_at: string | null;
    roles: Role[];
}

interface AdminUsersResponse {
    users: AdminUser[];
}

// ============================================================
// Проверка прав
// ============================================================
async function checkAdmin(): Promise<boolean> {
    if (!state.token || !state.user) return false;
    try {
        const me = await apiRequest<{ user: { id: string; is_admin: boolean } }>(
            '/api/auth/me',
            { token: state.token }
        );
        return Boolean(me.user.is_admin);
    } catch {
        return false;
    }
}

// ============================================================
// Пользователи
// ============================================================
const usersBox = document.getElementById('admin-users');
const searchInput = document.getElementById('admin-search') as HTMLInputElement | null;

async function loadUsers(query = ''): Promise<void> {
    if (!usersBox) return;

    usersBox.innerHTML = '<div class="skeleton skeleton-block"></div>';

    try {
        const url = query
            ? `/api/admin/users?q=${encodeURIComponent(query)}`
            : '/api/admin/users';
        const res = await apiRequest<AdminUsersResponse>(url, {
            token: state.token,
        });
        renderUsers(res.users);
    } catch (err) {
        usersBox.innerHTML = `<p class="error">Ошибка: ${err instanceof Error ? err.message : String(err)
            }</p>`;
    }
}

function renderUsers(users: AdminUser[]): void {
    if (!usersBox) return;

    if (users.length === 0) {
        usersBox.innerHTML = '<p class="hint">Ничего не найдено</p>';
        return;
    }

    usersBox.innerHTML = '';
    for (const u of users) {
        usersBox.appendChild(buildUserCard(u));
    }
}

function buildUserCard(u: AdminUser): HTMLElement {
    const card = document.createElement('div');
    card.className = 'admin-user-card';

    // Левая часть: инфо
    const info = document.createElement('div');
    info.className = 'admin-user-info';

    const email = document.createElement('div');
    email.className = 'admin-user-email';
    email.textContent = u.email;

    const username = document.createElement('div');
    username.className = 'admin-user-username';
    username.textContent = u.username ?? '— без ника —';

    info.append(email, username);

    // Роли
    if (u.roles.length > 0) {
        const rolesWrap = document.createElement('div');
        rolesWrap.className = 'admin-user-roles';
        for (const r of u.roles) {
            const badge = document.createElement('span');
            badge.className = `role-badge role-badge--${r}`;
            badge.textContent = r === 'admin' ? '★ ADMIN' : '◆ MOD';
            rolesWrap.appendChild(badge);
        }
        info.appendChild(rolesWrap);
    }

    card.appendChild(info);

    // Правая часть: кнопки
    const actions = document.createElement('div');
    actions.className = 'admin-user-actions';

    const isMod = u.roles.includes('moderator');
    const isAdmin = u.roles.includes('admin');

    // Кнопка модератора
    const modBtn = document.createElement('button');
    modBtn.type = 'button';
    modBtn.className = isMod ? 'admin-role-btn is-active' : 'admin-role-btn';
    modBtn.textContent = isMod ? '◆ Забрать MOD' : '◆ Выдать MOD';
    modBtn.addEventListener('click', () => {
        void toggleRole(u, 'moderator', isMod);
    });
    actions.appendChild(modBtn);

    // Кнопка админа
    const adminBtn = document.createElement('button');
    adminBtn.type = 'button';
    adminBtn.className = isAdmin ? 'admin-role-btn admin-role-btn--admin is-active' : 'admin-role-btn admin-role-btn--admin';
    adminBtn.textContent = isAdmin ? '★ Забрать ADMIN' : '★ Выдать ADMIN';
    adminBtn.addEventListener('click', () => {
        void toggleRole(u, 'admin', isAdmin);
    });
    actions.appendChild(adminBtn);

    card.appendChild(actions);

    return card;
}

async function toggleRole(
    user: AdminUser,
    role: Role,
    currentlyHas: boolean
): Promise<void> {
    const action = currentlyHas ? 'revoke' : 'grant';
    const verb = currentlyHas ? 'забрать' : 'выдать';
    const roleName = role === 'admin' ? 'ADMIN' : 'MOD';

    if (!confirm(`${verb.toUpperCase()} роль ${roleName} у ${user.email}?`)) {
        return;
    }

    try {
        await apiRequest(`/api/admin/roles/${action}`, {
            method: 'POST',
            token: state.token,
            body: { userId: user.id, role },
        });
        await loadUsers(searchInput?.value ?? '');
    } catch (err) {
        alert(
            `Не удалось ${verb} роль: ` +
            (err instanceof Error ? err.message : String(err))
        );
    }
}

// ============================================================
// Игроки
// ============================================================
const playersBox = document.getElementById('admin-players');

let cachedPlayers: PlayerWithStats[] = [];

async function loadPlayers(): Promise<void> {
    if (!playersBox) return;
    playersBox.innerHTML = '<div class="skeleton skeleton-block"></div>';

    try {
        const res = await apiRequest<PlayersListResponse>('/api/players', {
            token: state.token,
        });
        cachedPlayers = res.players;
        renderPlayersFiltered();
    } catch (err) {
        playersBox.innerHTML = `<p class="error">Ошибка: ${err instanceof Error ? err.message : String(err)
            }</p>`;
    }
}

function renderPlayersFiltered(): void {
    const q = (document.getElementById('admin-players-search') as HTMLInputElement | null)?.value
        .trim()
        .toLowerCase() ?? '';

    const filtered = q
        ? cachedPlayers.filter((p) =>
            p.name.toLowerCase().includes(q) ||
            (p.aka ?? '').toLowerCase().includes(q)
        )
        : cachedPlayers;

    renderPlayers(filtered);
}

function renderPlayers(players: PlayerWithStats[]): void {
    if (!playersBox) return;

    if (players.length === 0) {
        playersBox.innerHTML = '<p class="hint">Пока нет игроков</p>';
        return;
    }

    playersBox.innerHTML = '';

    const table = document.createElement('table');
    table.className = 'admin-players-table';

    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    for (const label of ['', 'Имя', 'Голосов', 'Итого', '']) {
        const th = document.createElement('th');
        th.textContent = label;
        headRow.appendChild(th);
    }
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    for (const p of players) {
        const tr = document.createElement('tr');
        tr.className = 'admin-player-row';

        // Кнопка раскрытия
        const tdExpand = document.createElement('td');
        tdExpand.className = 'admin-expand-cell';
        const expandBtn = document.createElement('button');
        expandBtn.type = 'button';
        expandBtn.className = 'admin-expand-btn';
        expandBtn.textContent = '▸';
        expandBtn.title = 'Показать оценки';
        tdExpand.appendChild(expandBtn);
        tr.appendChild(tdExpand);

        const tdName = document.createElement('td');
        tdName.textContent = p.name;
        tr.appendChild(tdName);

        const tdVotes = document.createElement('td');
        tdVotes.textContent = String(p.vote_count);
        tr.appendChild(tdVotes);

        const tdTotal = document.createElement('td');
        const total = ['adaptiveness', 'greed', 'survival', 'turtle', 'aggression', 'variety']
            .reduce((sum, key) => {
                const v = (p as any)[key];
                return sum + (typeof v === 'number' ? v : 0);
            }, 0);
        tdTotal.textContent = p.vote_count > 0 ? total.toFixed(2) : '—';
        tr.appendChild(tdTotal);

        const tdActions = document.createElement('td');
        tdActions.className = 'admin-player-actions';

        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'btn-danger';
        delBtn.textContent = '🗑 Удалить игрока';
        delBtn.addEventListener('click', () => void deletePlayer(p));
        tdActions.appendChild(delBtn);

        tr.appendChild(tdActions);
        tbody.appendChild(tr);

        // Скрытая строка с оценками (открывается по клику)
        const trRatings = document.createElement('tr');
        trRatings.className = 'admin-ratings-row hidden';
        const tdRatings = document.createElement('td');
        tdRatings.colSpan = 5;
        tdRatings.className = 'admin-ratings-cell';
        trRatings.appendChild(tdRatings);
        tbody.appendChild(trRatings);

        // Обработчик раскрытия
        let loaded = false;
        expandBtn.addEventListener('click', () => {
            const isOpen = !trRatings.classList.contains('hidden');

            if (isOpen) {
                trRatings.classList.add('hidden');
                expandBtn.textContent = '▸';
                return;
            }

            trRatings.classList.remove('hidden');
            expandBtn.textContent = '▾';

            if (!loaded) {
                loaded = true;
                void loadPlayerRatings(p.id, tdRatings);
            }
        });

        const renameBtn = document.createElement('button');
        renameBtn.type = 'button';
        renameBtn.className = 'admin-rename-btn';
        renameBtn.textContent = '✎ Имя';
        renameBtn.title = 'Переименовать игрока';
        renameBtn.addEventListener('click', () => {
            void renamePlayer(p);
        });
        tdActions.appendChild(renameBtn);

        const akaBtn = document.createElement('button');
        akaBtn.type = 'button';
        akaBtn.className = 'admin-aka-btn';
        akaBtn.textContent = '✎ aka';
        akaBtn.title = 'Изменить альтернативное имя';
        akaBtn.addEventListener('click', () => {
            void editAka(p);
        });
        tdActions.appendChild(akaBtn);
    }

    table.appendChild(tbody);
    playersBox.appendChild(table);
}

async function renamePlayer(player: PlayerWithStats): Promise<void> {
    const next = prompt(
        `Новое имя для "${player.name}":`,
        player.name
    );
    if (next === null) return; // отмена

    const trimmed = next.trim();
    if (!trimmed) {
        alert('Имя не может быть пустым');
        return;
    }
    if (trimmed === player.name) return; // ничего не изменилось

    try {
        await apiRequest(`/api/admin/players/${player.id}/name`, {
            method: 'PATCH',
            token: state.token,
            body: { name: trimmed },
        });
        await loadPlayers();
    } catch (err) {
        alert(
            'Не удалось переименовать: ' +
            (err instanceof Error ? err.message : String(err))
        );
    }
}

async function editAka(player: PlayerWithStats): Promise<void> {
    const current = player.aka ?? '';
    const next = prompt(
        `Альтернативные имена для "${player.name}" (через запятую):`,
        current
    );
    if (next === null) return; // отмена

    const trimmed = next.trim();

    try {
        await apiRequest(`/api/admin/players/${player.id}/aka`, {
            method: 'PATCH',
            token: state.token,
            body: { aka: trimmed || null },
        });
        await loadPlayers();
    } catch (err) {
        alert('Не удалось сохранить: ' + (err instanceof Error ? err.message : String(err)));
    }
}

async function deletePlayer(player: PlayerWithStats): Promise<void> {
    const confirmed = confirm(
        `Удалить игрока "${player.name}"?\n\n` +
        `Все его оценки (${player.vote_count}) будут удалены безвозвратно.`
    );
    if (!confirmed) return;

    try {
        await apiRequest(`/api/players/${player.id}`, {
            method: 'DELETE',
            token: state.token,
        });
        await loadPlayers();
    } catch (err) {
        alert(
            'Не удалось удалить: ' +
            (err instanceof Error ? err.message : String(err))
        );
    }
}

interface AdminRating {
    id: number;
    user_id: string;
    email: string;
    username: string | null;
    race: string;
    adaptiveness: number;
    greed: number;
    survival: number;
    turtle: number;
    aggression: number;
    variety: number;
    created_at: string;
    updated_at: string;
}

async function loadPlayerRatings(
    playerId: number,
    container: HTMLElement
): Promise<void> {
    container.innerHTML = '<div class="skeleton skeleton-block" style="height: 80px;"></div>';

    try {
        const res = await apiRequest<{ ratings: AdminRating[] }>(
            `/api/admin/players/${playerId}/ratings`,
            { token: state.token }
        );
        renderRatingsInAdmin(res.ratings, container, playerId);   // ← передаём playerId
    } catch (err) {
        container.innerHTML = `<p class="error">Ошибка: ${err instanceof Error ? err.message : String(err)
            }</p>`;
    }
}

function renderRatingsInAdmin(
    ratings: AdminRating[],
    container: HTMLElement,
    playerId: number        // ← ДОБАВЛЕНО
): void {
    if (ratings.length === 0) {
        container.innerHTML = '<p class="hint">Нет оценок</p>';
        return;
    }

    const table = document.createElement('table');
    table.className = 'admin-ratings-table';

    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    for (const label of [
        'Пользователь', 'Раса', 'Адапт', 'Халява', 'Выжив', 'Череп', 'Агресс', 'Разнообр', ''
    ]) {
        const th = document.createElement('th');
        th.textContent = label;
        headRow.appendChild(th);
    }
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    for (const r of ratings) {
        const tr = document.createElement('tr');

        const tdUser = document.createElement('td');
        tdUser.textContent = r.username || r.email || r.user_id;
        tr.appendChild(tdUser);

        const tdRace = document.createElement('td');
        tdRace.textContent = r.race;
        tr.appendChild(tdRace);

        for (const key of ['adaptiveness', 'greed', 'survival', 'turtle', 'aggression', 'variety'] as const) {
            const td = document.createElement('td');
            td.textContent = String(r[key]);
            tr.appendChild(td);
        }

        const tdActions = document.createElement('td');
        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'admin-rating-delete-btn';
        delBtn.textContent = '🗑';
        delBtn.title = 'Удалить оценку';
        delBtn.addEventListener('click', () => {
            void deleteRating(r, container, playerId);   // ← playerId теперь доступен
        });
        tdActions.appendChild(delBtn);
        tr.appendChild(tdActions);

        tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    container.innerHTML = '';
    container.appendChild(table);
}

async function deleteRating(
    rating: AdminRating,
    container: HTMLElement,
    playerId: number
): Promise<void> {
    const userLabel = rating.username || rating.email || rating.user_id;
    const confirmed = confirm(
        `Удалить оценку пользователя "${userLabel}"?\n\nЭто действие нельзя отменить.`
    );
    if (!confirmed) return;

    try {
        await apiRequest(`/api/admin/ratings/${rating.id}`, {
            method: 'DELETE',
            token: state.token,
        });
        // Перезагружаем список оценок в развёрнутой строке
        await loadPlayerRatings(playerId, container);
        // И обновляем таблицу игроков (vote_count мог измениться)
        await loadPlayers();
    } catch (err) {
        alert('Не удалось удалить: ' +
            (err instanceof Error ? err.message : String(err)));
    }
}
// ============================================================
// Инициализация
// ============================================================
async function init(): Promise<void> {
    const isAdmin = await checkAdmin();
    if (!isAdmin) {
        window.location.href = '/';
        return;
    }

    searchInput?.addEventListener('input', () => {
        void loadUsers(searchInput.value);
    });

    document.getElementById('admin-players-search')?.addEventListener('input', () => {
        renderPlayersFiltered();
    });

    await loadUsers();
    await loadPlayers();
}

void init();