import { apiRequest } from '../api';
import { state } from '../state';
import { t, getLocale } from '../i18n';
import { navigateTo } from '../router';
import type { PlayerWithStats, PlayersListResponse } from '../types';
import {
    listRefs,
    createRef,
    updateRef,
    deleteRef,
    type RefType,
    type RefItem,
    type GameFormat,
    type GameHost,
} from '../api/game-refs';

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

interface RefConfig {
    type: RefType;
    containerId: string;
    buttonId: string;
    titleKey: string;
    newPromptKey: string;
    newErrorKey: string;
    deleteConfirmKey: string;
    editableFields: ('slug' | 'elo_weight' | 'aka')[];
}

const REF_CONFIGS: RefConfig[] = [
    {
        type: 'formats',
        containerId: 'admin-formats',
        buttonId: 'btn-add-formats',
        titleKey: 'admin.formats_title',
        newPromptKey: 'admin.new_format_prompt',
        newErrorKey: 'admin.new_format_error',
        deleteConfirmKey: 'admin.delete_format_confirm',
        editableFields: ['slug', 'elo_weight'],
    },
    {
        type: 'hosts',
        containerId: 'admin-hosts',
        buttonId: 'btn-add-hosts',
        titleKey: 'admin.hosts_title',
        newPromptKey: 'admin.new_host_prompt',
        newErrorKey: 'admin.new_host_error',
        deleteConfirmKey: 'admin.delete_host_confirm',
        editableFields: ['aka'],
    },
    {
        type: 'maps',
        containerId: 'admin-maps',
        buttonId: 'btn-add-maps',
        titleKey: 'admin.maps_title',
        newPromptKey: 'admin.new_map_prompt',
        newErrorKey: 'admin.new_map_error',
        deleteConfirmKey: 'admin.delete_map_confirm',
        editableFields: [],
    },
    {
        type: 'mods',
        containerId: 'admin-mods',
        buttonId: 'btn-add-mods',
        titleKey: 'admin.mods_title',
        newPromptKey: 'admin.new_mod_prompt',
        newErrorKey: 'admin.new_mod_error',
        deleteConfirmKey: 'admin.delete_mod_confirm',
        editableFields: [],
    },
];

let abortController: AbortController | null = null;
let cachedPlayers: PlayerWithStats[] = [];
let usersBox: HTMLElement | null = null;
let playersBox: HTMLElement | null = null;
let searchInput: HTMLInputElement | null = null;
let playersSearchInput: HTMLInputElement | null = null;

const refsCache: Record<RefType, RefItem[]> = {
    formats: [],
    hosts: [],
    maps: [],
    mods: [],
};

// ============================================================
// Mount / unmount
// ============================================================
export function mountAdmin(_params: URLSearchParams): void {
    if (!state.token || !state.user) {
        sessionStorage.setItem('redirectAfterLogin', '/admin');
        navigateTo('/', true);
        return;
    }
    if (!state.user.is_admin) {
        navigateTo('/', true);
        return;
    }

    const screen = document.getElementById('screen-admin');
    if (screen) screen.classList.remove('hidden');

    abortController = new AbortController();
    const { signal } = abortController;

    usersBox = document.getElementById('admin-users');
    playersBox = document.getElementById('admin-players');
    searchInput = document.getElementById('admin-search') as HTMLInputElement | null;
    playersSearchInput = document.getElementById('admin-players-search') as HTMLInputElement | null;

    searchInput?.addEventListener('input', () => {
        void loadUsers(searchInput!.value);
    }, { signal });

    playersSearchInput?.addEventListener('input', () => {
        renderPlayersFiltered();
    }, { signal });

    // Справочники: кнопки «+ Добавить»
    for (const config of REF_CONFIGS) {
        const btn = document.getElementById(config.buttonId);
        btn?.addEventListener('click', () => {
            void addRefInline(config);
        }, { signal });
    }

    void loadUsers();
    void loadPlayers();

    for (const config of REF_CONFIGS) {
        void loadRefs(config);
    }
}

export function unmountAdmin(): void {
    abortController?.abort();
    abortController = null;
}

// ============================================================
// Пользователи
// ============================================================
async function loadUsers(query = ''): Promise<void> {
    if (!usersBox) return;
    usersBox.innerHTML = '<div class="skeleton skeleton-block"></div>';

    try {
        const url = query
            ? `/api/admin/users?q=${encodeURIComponent(query)}`
            : '/api/admin/users';
        const res = await apiRequest<AdminUsersResponse>(url, { token: state.token });
        renderUsers(res.users);
    } catch (err) {
        usersBox.innerHTML = `<p class="error">${t('common.error')}: ${err instanceof Error ? err.message : String(err)
            }</p>`;
    }
}

function renderUsers(users: AdminUser[]): void {
    if (!usersBox) return;

    if (users.length === 0) {
        usersBox.innerHTML = `<p class="hint">${t('admin.no_users')}</p>`;
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

    const info = document.createElement('div');
    info.className = 'admin-user-info';

    const email = document.createElement('div');
    email.className = 'admin-user-email';
    email.textContent = u.email;

    const username = document.createElement('div');
    username.className = 'admin-user-username';
    username.textContent = u.username ?? t('admin.user_no_username');

    info.append(email, username);

    if (u.created_at) {
        const reg = document.createElement('div');
        reg.className = 'admin-user-registered';
        const d = new Date(u.created_at);
        const formatted = d.toLocaleDateString(
            getLocale() === 'ru' ? 'ru-RU' : 'en-US',
            { day: '2-digit', month: '2-digit', year: 'numeric' }
        );
        reg.textContent = `${t('admin.registered_at')}: ${formatted}`;
        info.appendChild(reg);
    }

    if (u.roles.length > 0) {
        const rolesWrap = document.createElement('div');
        rolesWrap.className = 'admin-user-roles';
        for (const r of u.roles) {
            const badge = document.createElement('span');
            badge.className = `role-badge role-badge--${r}`;
            badge.textContent = r === 'admin'
                ? `★ ${t('topbar.role_admin')}`
                : `◆ ${t('topbar.role_moderator')}`;
            rolesWrap.appendChild(badge);
        }
        info.appendChild(rolesWrap);
    }

    card.appendChild(info);

    const actions = document.createElement('div');
    actions.className = 'admin-user-actions';

    const isMod = u.roles.includes('moderator');
    const isAdmin = u.roles.includes('admin');

    const modBtn = document.createElement('button');
    modBtn.type = 'button';
    modBtn.className = isMod ? 'admin-role-btn is-active' : 'admin-role-btn';
    modBtn.textContent = isMod ? `◆ ${t('admin.revoke_mod')}` : `◆ ${t('admin.grant_mod')}`;
    modBtn.addEventListener('click', () => void toggleRole(u, 'moderator', isMod));
    actions.appendChild(modBtn);

    const adminBtn = document.createElement('button');
    adminBtn.type = 'button';
    adminBtn.className = isAdmin
        ? 'admin-role-btn admin-role-btn--admin is-active'
        : 'admin-role-btn admin-role-btn--admin';
    adminBtn.textContent = isAdmin ? `★ ${t('admin.revoke_admin')}` : `★ ${t('admin.grant_admin')}`;
    adminBtn.addEventListener('click', () => void toggleRole(u, 'admin', isAdmin));
    actions.appendChild(adminBtn);

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'admin-user-delete-btn';
    delBtn.textContent = '🗑';
    delBtn.title = t('admin.delete_user');
    delBtn.addEventListener('click', () => void deleteUser(u));
    actions.appendChild(delBtn);

    card.appendChild(actions);
    return card;
}

async function toggleRole(user: AdminUser, role: Role, currentlyHas: boolean): Promise<void> {
    const action = currentlyHas ? 'revoke' : 'grant';
    const roleName = role === 'admin' ? 'ADMIN' : 'MOD';

    if (!confirm(t('admin.role_toggle_confirm', { role: roleName, email: user.email }))) return;

    try {
        await apiRequest(`/api/admin/roles/${action}`, {
            method: 'POST',
            token: state.token,
            body: { userId: user.id, role },
        });
        await loadUsers(searchInput?.value ?? '');
    } catch (err) {
        alert(t('admin.role_toggle_error') + (err instanceof Error ? err.message : String(err)));
    }
}

async function deleteUser(user: AdminUser): Promise<void> {
    const label = user.username || user.email;
    if (!confirm(t('admin.delete_user_confirm', { user: label }))) return;

    try {
        await apiRequest(`/api/admin/users/${user.id}`, {
            method: 'DELETE',
            token: state.token,
        });
        await loadUsers(searchInput?.value ?? '');
    } catch (err) {
        alert(t('admin.delete_user_error') + (err instanceof Error ? err.message : String(err)));
    }
}

// ============================================================
// Игроки
// ============================================================
async function loadPlayers(): Promise<void> {
    if (!playersBox) return;
    playersBox.innerHTML = '<div class="skeleton skeleton-block"></div>';

    try {
        const res = await apiRequest<PlayersListResponse>('/api/players', { token: state.token });
        cachedPlayers = res.players;
        renderPlayersFiltered();
    } catch (err) {
        playersBox.innerHTML = `<p class="error">${t('common.error')}: ${err instanceof Error ? err.message : String(err)
            }</p>`;
    }
}

function renderPlayersFiltered(): void {
    const q = (playersSearchInput?.value ?? '').trim().toLowerCase();
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
        playersBox.innerHTML = `<p class="hint">${t('players.no_players')}</p>`;
        return;
    }

    playersBox.innerHTML = '';

    const table = document.createElement('table');
    table.className = 'admin-players-table';

    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    for (const label of ['', t('players.col.name'), t('player.votes'), t('players.col.total'), '']) {
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

        const tdExpand = document.createElement('td');
        tdExpand.className = 'admin-expand-cell';
        const expandBtn = document.createElement('button');
        expandBtn.type = 'button';
        expandBtn.className = 'admin-expand-btn';
        expandBtn.textContent = '▸';
        tdExpand.appendChild(expandBtn);
        tr.appendChild(tdExpand);

        const tdName = document.createElement('td');

        const nameWrap = document.createElement('div');
        nameWrap.className = 'admin-player-name';

        const nameText = document.createElement('span');
        nameText.textContent = p.name;
        nameWrap.appendChild(nameText);

        if (p.user_id) {
            const linked = document.createElement('span');
            linked.className = 'admin-linked-badge';
            linked.textContent = `🔗 ${t('admin.linked_player')}`;
            linked.title = p.user_id;
            nameWrap.appendChild(linked);
        }

        tdName.appendChild(nameWrap);
        tr.appendChild(tdName);

        const tdVotes = document.createElement('td');
        tdVotes.textContent = String(p.vote_count);
        tr.appendChild(tdVotes);

        const tdTotal = document.createElement('td');
        const total = ['adaptiveness', 'greed', 'survival', 'turtle', 'aggression', 'variety']
            .reduce((sum, key) => sum + ((p as any)[key] ?? 0), 0);
        tdTotal.textContent = p.vote_count > 0 ? total.toFixed(2) : '—';
        tr.appendChild(tdTotal);

        const tdActions = document.createElement('td');
        tdActions.className = 'admin-player-actions';

        const renameBtn = document.createElement('button');
        renameBtn.type = 'button';
        renameBtn.className = 'admin-rename-btn';
        renameBtn.textContent = `✎ ${t('admin.rename_button')}`;
        renameBtn.addEventListener('click', () => void renamePlayer(p));
        tdActions.appendChild(renameBtn);

        const akaBtn = document.createElement('button');
        akaBtn.type = 'button';
        akaBtn.className = 'admin-aka-btn';
        akaBtn.textContent = `✎ ${t('admin.aka_button')}`;
        akaBtn.addEventListener('click', () => void editAka(p));
        tdActions.appendChild(akaBtn);

        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'btn-danger';
        delBtn.textContent = `🗑 ${t('admin.delete_button')}`;
        delBtn.addEventListener('click', () => void deletePlayer(p));
        tdActions.appendChild(delBtn);

        const linkBtn = document.createElement('button');
        linkBtn.type = 'button';
        linkBtn.className = 'admin-link-btn';
        if (p.user_id) linkBtn.classList.add('is-linked');
        linkBtn.textContent = p.user_id
            ? `⛓ ${t('admin.unlink_user')}`
            : `🔗 ${t('admin.link_user')}`;
        linkBtn.title = p.user_id
            ? t('admin.unlink_user_title')
            : t('admin.link_user_title');
        linkBtn.addEventListener('click', () => {
            if (p.user_id) {
                void unlinkUser(p);
            } else {
                void linkUser(p);
            }
        });
        tdActions.appendChild(linkBtn);

        tr.appendChild(tdActions);
        tbody.appendChild(tr);

        const trRatings = document.createElement('tr');
        trRatings.className = 'admin-ratings-row hidden';
        const tdRatings = document.createElement('td');
        tdRatings.colSpan = 5;
        tdRatings.className = 'admin-ratings-cell';
        trRatings.appendChild(tdRatings);
        tbody.appendChild(trRatings);

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
    }
    table.appendChild(tbody);
    playersBox.appendChild(table);
}

async function loadPlayerRatings(playerId: number, container: HTMLElement): Promise<void> {
    container.innerHTML = '<div class="skeleton skeleton-block" style="height: 80px;"></div>';

    try {
        const res = await apiRequest<{ ratings: AdminRating[] }>(
            `/api/admin/players/${playerId}/ratings`,
            { token: state.token }
        );
        renderRatingsInAdmin(res.ratings, container, playerId);
    } catch (err) {
        container.innerHTML = `<p class="error">${t('common.error')}: ${err instanceof Error ? err.message : String(err)
            }</p>`;
    }
}

function renderRatingsInAdmin(
    ratings: AdminRating[],
    container: HTMLElement,
    playerId: number
): void {
    if (ratings.length === 0) {
        container.innerHTML = `<p class="hint">${t('admin.ratings_empty')}</p>`;
        return;
    }

    const table = document.createElement('table');
    table.className = 'admin-ratings-table';

    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    for (const label of [
        t('ratings.col.user'), t('ratings.col.race'),
        t('stat.adaptiveness'), t('stat.greed'), t('stat.survival'),
        t('stat.turtle'), t('stat.aggression'), t('stat.variety'),
        ''
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
        delBtn.addEventListener('click', () => void deleteRating(r, container, playerId));
        tdActions.appendChild(delBtn);
        tr.appendChild(tdActions);

        tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    container.innerHTML = '';
    container.appendChild(table);
}

async function deleteRating(rating: AdminRating, container: HTMLElement, playerId: number): Promise<void> {
    const userLabel = rating.username || rating.email || rating.user_id;
    if (!confirm(t('admin.rating_delete_confirm', { user: userLabel }))) return;

    try {
        await apiRequest(`/api/admin/ratings/${rating.id}`, {
            method: 'DELETE',
            token: state.token,
        });
        await loadPlayerRatings(playerId, container);
        await loadPlayers();
    } catch (err) {
        alert(t('games.delete_error') + (err instanceof Error ? err.message : String(err)));
    }
}

async function deletePlayer(p: PlayerWithStats): Promise<void> {
    if (!confirm(t('admin.player_delete_confirm', { name: p.name, count: p.vote_count }))) return;

    try {
        await apiRequest(`/api/players/${p.id}`, {
            method: 'DELETE',
            token: state.token,
        });
        await loadPlayers();
    } catch (err) {
        alert(t('games.delete_error') + (err instanceof Error ? err.message : String(err)));
    }
}

async function renamePlayer(p: PlayerWithStats): Promise<void> {
    const next = prompt(t('player.name_title', { name: p.name }), p.name);
    if (next === null) return;
    const trimmed = next.trim();
    if (!trimmed) {
        alert(t('player.name_empty_error'));
        return;
    }
    if (trimmed === p.name) return;

    try {
        await apiRequest(`/api/players/${p.id}/name`, {
            method: 'PATCH',
            token: state.token,
            body: { name: trimmed },
        });
        await loadPlayers();
    } catch (err) {
        alert(t('player.name_save_error') + (err instanceof Error ? err.message : String(err)));
    }
}

async function editAka(p: PlayerWithStats): Promise<void> {
    const next = prompt(t('player.aka_title', { name: p.name }), p.aka ?? '');
    if (next === null) return;

    try {
        await apiRequest(`/api/players/${p.id}/aka`, {
            method: 'PATCH',
            token: state.token,
            body: { aka: next.trim() || null },
        });
        await loadPlayers();
    } catch (err) {
        alert(t('player.aka_save_error') + (err instanceof Error ? err.message : String(err)));
    }
}

// ============================================================
// Универсальные справочники
// ============================================================
async function loadRefs(config: RefConfig): Promise<void> {
    const box = document.getElementById(config.containerId);
    if (!box) return;
    box.innerHTML = '<div class="skeleton skeleton-block"></div>';

    try {
        const items = await listRefs(config.type);
        refsCache[config.type] = items;
        renderRefs(config);
    } catch {
        box.innerHTML = `<p class="error">${t('common.error')}</p>`;
    }
}

function renderRefs(config: RefConfig): void {
    const box = document.getElementById(config.containerId);
    if (!box) return;

    const items = refsCache[config.type];

    if (items.length === 0) {
        box.innerHTML = `<p class="hint">${t('common.empty')}</p>`;
        return;
    }

    box.innerHTML = '';
    for (const item of items) {
        box.appendChild(buildRefCard(config, item));
    }
}

function buildRefCard(config: RefConfig, item: RefItem): HTMLElement {
    const card = document.createElement('div');
    card.className = 'admin-ref-card';

    // --- Название (редактируемое) ---
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'admin-ref-input';
    nameInput.value = item.name;
    card.appendChild(nameInput);

    // --- Доп. поля ---
    const extraInputs: Record<string, HTMLInputElement> = {};

    for (const field of config.editableFields) {
        const input = document.createElement('input');
        input.className = 'admin-ref-input';

        if (field === 'slug') {
            input.type = 'text';
            input.value = (item as GameFormat).slug ?? '';
            input.placeholder = 'slug';
        } else if (field === 'elo_weight') {
            input.type = 'number';
            input.className = 'admin-ref-input admin-ref-input--small';
            input.value = String((item as GameFormat).elo_weight ?? 1.0);
            input.step = '0.05';
            input.min = '0.1';
            input.max = '2.0';
            input.title = t('admin.elo_weight');
        } else if (field === 'aka') {
            input.type = 'text';
            input.value = (item as GameHost).aka ?? '';
            input.placeholder = 'aka';
        }

        extraInputs[field] = input;
        card.appendChild(input);
    }

    // --- Кнопки ---
    const actions = document.createElement('div');
    actions.className = 'admin-ref-actions';

    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'admin-ref-btn admin-ref-btn--save';
    saveBtn.textContent = '✓';
    saveBtn.title = t('common.save');
    saveBtn.addEventListener('click', () => {
        void saveRef(config, item, nameInput.value, extraInputs);
    });
    actions.appendChild(saveBtn);

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'admin-ref-btn admin-ref-btn--delete';
    delBtn.textContent = '🗑';
    delBtn.title = t('common.delete');
    delBtn.addEventListener('click', () => {
        void deleteRefItem(config, item);
    });
    actions.appendChild(delBtn);

    card.appendChild(actions);
    return card;
}

async function addRefInline(config: RefConfig): Promise<void> {
    const name = prompt(t(config.newPromptKey as any));
    if (name === null) return;
    const trimmed = name.trim();
    if (!trimmed) return;

    const payload: Record<string, unknown> = { name: trimmed };

    if (config.type === 'formats') {
        const slug = trimmed
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '');
        payload.slug = slug || `format-${Date.now()}`;
        payload.sort_order = 100;
        payload.elo_weight = 1.0;
    }

    try {
        await createRef(config.type, payload, state.token);
        await loadRefs(config);
    } catch (err) {
        alert(t(config.newErrorKey as any) + (err instanceof Error ? err.message : String(err)));
    }
}

async function saveRef(
    config: RefConfig,
    item: RefItem,
    newName: string,
    extraInputs: Record<string, HTMLInputElement>
): Promise<void> {
    const trimmedName = newName.trim();
    if (!trimmedName) {
        alert(t('common.error') + ': name is empty');
        return;
    }

    const payload: Record<string, unknown> = { name: trimmedName };

    for (const [field, input] of Object.entries(extraInputs)) {
        if (field === 'slug') payload.slug = input.value.trim();
        else if (field === 'elo_weight') payload.elo_weight = Number(input.value);
        else if (field === 'aka') payload.aka = input.value.trim() || null;
    }

    try {
        await updateRef(config.type, item.id, payload, state.token);
        await loadRefs(config);
    } catch (err) {
        alert(t('common.error') + ': ' + (err instanceof Error ? err.message : String(err)));
    }
}

async function deleteRefItem(config: RefConfig, item: RefItem): Promise<void> {
    if (!confirm(t(config.deleteConfirmKey as any, { name: item.name }))) return;

    try {
        await deleteRef(config.type, item.id, state.token);
        await loadRefs(config);
    } catch (err) {
        alert(t('common.error') + ': ' + (err instanceof Error ? err.message : String(err)));
    }
}

async function linkUser(p: PlayerWithStats): Promise<void> {
    const input = prompt(t('admin.link_user_prompt', { name: p.name }));
    if (input === null) return;
    const trimmed = input.trim();
    if (!trimmed) return;

    // Определяем, email это или username
    const isEmail = trimmed.includes('@');
    const body = isEmail ? { email: trimmed } : { username: trimmed };

    try {
        await apiRequest(`/api/admin/players/${p.id}/link-user`, {
            method: 'POST',
            token: state.token,
            body,
        });
        await loadPlayers();
    } catch (err) {
        alert(t('admin.link_user_error') + (err instanceof Error ? err.message : String(err)));
    }
}

async function unlinkUser(p: PlayerWithStats): Promise<void> {
    if (!confirm(t('admin.unlink_user_confirm', { name: p.name }))) return;

    try {
        await apiRequest(`/api/admin/players/${p.id}/unlink-user`, {
            method: 'POST',
            token: state.token,
        });
        await loadPlayers();
    } catch (err) {
        alert(t('common.error') + ': ' + (err instanceof Error ? err.message : String(err)));
    }
}