import { apiRequest } from '../api';
import { state, saveSession } from '../state';
import { t, getLocale } from '../i18n';
import { navigateTo } from '../router';
import type { PlayerWithStats, PlayersListResponse, TitleSize } from '../types';
import { TITLE_SIZES } from '../types';
import {
    listRefs,
    createRef,
    updateRef,
    deleteRef,
    type RefType,
    type RefItem,
    type GameFormat,
    type GameHost,
    type GameMap,
} from '../api/game-refs';
import { TITLE_COLORS } from '../titles';

type Role = 'moderator' | 'admin' | 'ghost';

interface AdminUser {
    id: string;
    email: string;
    username: string | null;
    created_at: string | null;
    last_seen_at: string | null;
    roles: Role[];
    player_name: string | null;
    can_rate: boolean;
    banned_at: string | null;
}

interface AdminUsersResponse {
    users: AdminUser[];
}

interface AdminArchivedRating {
    id: number;
    original_id: number;
    player_id: number;
    user_id: string;
    player_name: string | null;
    user_name: string | null;
    race: string;
    adaptiveness: number;
    greed: number;
    survival: number;
    turtle: number;
    aggression: number;
    variety: number;
    deleted_at: string;
}

interface AdminArchiveResponse {
    archived: AdminArchivedRating[];
    total: number;
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

interface AdminLog {
    id: number;
    created_at: string;
    actor_id: string | null;
    actor_username: string | null;
    action: string;
    entity_type: string | null;
    entity_id: number | null;
    summary: string;
    details: Record<string, unknown>;
}

interface AdminLogsResponse {
    logs: AdminLog[];
    total: number;
}

interface AdminTitle {
    id: number;
    name: string;
    color: string;
    size?: TitleSize;
    player_ids: number[];
}

const LOG_ACTIONS: { value: string; key: string }[] = [
    { value: 'auth.signup', key: 'log.action.signup' },
    { value: 'auth.login', key: 'log.action.login' },
    { value: 'auth.logout', key: 'log.action.logout' },
    { value: 'player.create', key: 'log.action.player_create' },
    { value: 'player.rename', key: 'log.action.player_rename' },
    { value: 'player.aka', key: 'log.action.player_aka' },
    { value: 'player.delete', key: 'log.action.player_delete' },
    { value: 'player.link', key: 'log.action.player_link' },
    { value: 'player.unlink', key: 'log.action.player_unlink' },
    { value: 'rating.create', key: 'log.action.rating_create' },
    { value: 'rating.update', key: 'log.action.rating_update' },
    { value: 'rating.delete', key: 'log.action.rating_delete' },
    { value: 'game.create', key: 'log.action.game_create' },
    { value: 'game.update', key: 'log.action.game_update' },
    { value: 'game.delete', key: 'log.action.game_delete' },
    { value: 'ref.create', key: 'log.action.ref_create' },
    { value: 'ref.update', key: 'log.action.ref_update' },
    { value: 'ref.delete', key: 'log.action.ref_delete' },
    { value: 'role.grant', key: 'log.action.role_grant' },
    { value: 'role.revoke', key: 'log.action.role_revoke' },
    { value: 'user.delete', key: 'log.action.user_delete' },
    { value: 'user.rate_allow', key: 'log.action.user_rate_allow' },
    { value: 'user.rate_block', key: 'log.action.user_rate_block' },
    { value: 'user.impersonate', key: 'log.action.user_impersonate' },
    { value: 'title.create', key: 'log.action.title_create' },
    { value: 'title.update', key: 'log.action.title_update' },
    { value: 'title.delete', key: 'log.action.title_delete' },
    { value: 'title.assign', key: 'log.action.title_assign' },
    { value: 'title.unassign', key: 'log.action.title_unassign' },
];

const LOG_ACTION_LABELS: Record<string, string> = {};
for (const a of LOG_ACTIONS) LOG_ACTION_LABELS[a.value] = a.key;

interface RefConfig {
    type: RefType;
    containerId: string;
    buttonId: string;
    titleKey: string;
    newPromptKey: string;
    newErrorKey: string;
    deleteConfirmKey: string;
    editableFields: ('slug' | 'elo_weight' | 'aka' | 'alt_name' | 'player_id')[];
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
        editableFields: ['aka', 'player_id'],
    },
    {
        type: 'maps',
        containerId: 'admin-maps',
        buttonId: 'btn-add-maps',
        titleKey: 'admin.maps_title',
        newPromptKey: 'admin.new_map_prompt',
        newErrorKey: 'admin.new_map_error',
        deleteConfirmKey: 'admin.delete_map_confirm',
        editableFields: ['alt_name'],
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
let logsBox: HTMLElement | null = null;
let logsSearchInput: HTMLInputElement | null = null;
let logsActionSelect: HTMLSelectElement | null = null;
let archiveBox: HTMLElement | null = null;
let archiveSearchInput: HTMLInputElement | null = null;
let titlesBox: HTMLElement | null = null;

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
    logsBox = document.getElementById('admin-logs');
    logsSearchInput = document.getElementById('admin-logs-search') as HTMLInputElement | null;
    logsActionSelect = document.getElementById('admin-logs-action') as HTMLSelectElement | null;
    archiveBox = document.getElementById('admin-ratings-archive');
    archiveSearchInput = document.getElementById('admin-archive-search') as HTMLInputElement | null;
    titlesBox = document.getElementById('admin-titles');

    searchInput?.addEventListener('input', () => {
        void loadUsers(searchInput!.value);
    }, { signal });

    playersSearchInput?.addEventListener('input', () => {
        renderPlayersFiltered();
    }, { signal });

    populateLogActionOptions();
    logsSearchInput?.addEventListener('input', () => {
        void loadLogs();
    }, { signal });
    logsActionSelect?.addEventListener('change', () => {
        void loadLogs();
    }, { signal });
    document.getElementById('btn-admin-logs-refresh')?.addEventListener('click', () => {
        void loadLogs(true);
    }, { signal });
    archiveSearchInput?.addEventListener('input', () => {
        void loadArchive();
    }, { signal });
    document.getElementById('btn-admin-archive-refresh')?.addEventListener('click', () => {
        void loadArchive();
    }, { signal });

    // Справочники: кнопки «+ Добавить»
    for (const config of REF_CONFIGS) {
        const btn = document.getElementById(config.buttonId);
        btn?.addEventListener('click', () => {
            void addRefInline(config);
        }, { signal });
    }

    // Титулы
    document.getElementById('btn-add-title')?.addEventListener('click', () => {
        void createTitle();
    }, { signal });

    void loadUsers();
    void loadLogs();
    void loadArchive();

    // Игроки грузим раньше справочников, чтобы в карточках ведущих был список игроков.
    void loadPlayers().then(() => {
        for (const config of REF_CONFIGS) {
            void loadRefs(config);
        }
        void loadTitles();
    });
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

function roleBadgeLabel(role: Role): string {
    if (role === 'admin') return `★ ${t('topbar.role_admin')}`;
    if (role === 'ghost') return `💠 ${t('topbar.role_ghost')}`;
    return `◆ ${t('topbar.role_moderator')}`;
}

function buildUserCard(u: AdminUser): HTMLElement {
    const card = document.createElement('div');
    card.className = 'admin-user-card' + (u.banned_at ? ' is-banned' : '');

    const info = document.createElement('div');
    info.className = 'admin-user-info';

    const email = document.createElement('div');
    email.className = 'admin-user-email';
    email.textContent = u.email;

    const username = document.createElement('div');
    username.className = 'admin-user-username';
    username.textContent = u.username ?? t('admin.user_no_username');

    info.append(email, username);

    if (u.banned_at) {
        const bannedBadge = document.createElement('span');
        bannedBadge.className = 'role-badge role-badge--banned';
        bannedBadge.textContent = t('admin.user_banned');
        info.appendChild(bannedBadge);
    }

    if (u.player_name) {
        const linkedPlayer = document.createElement('div');
        linkedPlayer.className = 'admin-user-player';
        linkedPlayer.textContent = `🔗 ${t('admin.user_linked_player', { name: u.player_name })}`;
        info.appendChild(linkedPlayer);
    }

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

    if (u.last_seen_at) {
        const lastSeen = document.createElement('div');
        lastSeen.className = 'admin-user-lastseen';
        const d = new Date(u.last_seen_at);
        const formatted = d.toLocaleDateString(
            getLocale() === 'ru' ? 'ru-RU' : 'en-US',
            { day: '2-digit', month: '2-digit', year: 'numeric' }
        );
        lastSeen.textContent = `${t('admin.last_seen')}: ${formatted} · ${relativeTime(u.last_seen_at)}`;
        lastSeen.title = d.toLocaleString();
        info.appendChild(lastSeen);
    }

    if (u.roles.length > 0) {
        const rolesWrap = document.createElement('div');
        rolesWrap.className = 'admin-user-roles';
        for (const r of u.roles) {
            const badge = document.createElement('span');
            badge.className = `role-badge role-badge--${r}`;
            badge.textContent = roleBadgeLabel(r);
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

    const isGhost = u.roles.includes('ghost');
    const ghostBtn = document.createElement('button');
    ghostBtn.type = 'button';
    ghostBtn.className = isGhost
        ? 'admin-role-btn admin-role-btn--ghost is-active'
        : 'admin-role-btn admin-role-btn--ghost';
    ghostBtn.textContent = isGhost ? `💠 ${t('admin.revoke_ghost')}` : `💠 ${t('admin.grant_ghost')}`;
    ghostBtn.addEventListener('click', () => void toggleRole(u, 'ghost', isGhost));
    actions.appendChild(ghostBtn);

    const rateBtn = document.createElement('button');
    rateBtn.type = 'button';
    rateBtn.className = u.can_rate
        ? 'admin-role-btn admin-role-btn--rate'
        : 'admin-role-btn admin-role-btn--rate is-active';
    rateBtn.textContent = u.can_rate
        ? `🚫 ${t('admin.disable_rate')}`
        : `✓ ${t('admin.enable_rate')}`;
    rateBtn.title = u.can_rate
        ? t('admin.disable_rate_title')
        : t('admin.enable_rate_title');
    rateBtn.addEventListener('click', () => void toggleCanRate(u));
    actions.appendChild(rateBtn);

    const banBtn = document.createElement('button');
    banBtn.type = 'button';
    banBtn.className = u.banned_at
        ? 'admin-role-btn admin-role-btn--ban is-active'
        : 'admin-role-btn admin-role-btn--ban';
    banBtn.textContent = u.banned_at
        ? `🔓 ${t('admin.unban_user')}`
        : `🔨 ${t('admin.ban_user')}`;
    banBtn.title = u.banned_at
        ? t('admin.unban_title')
        : t('admin.ban_title');
    banBtn.addEventListener('click', () => void toggleBan(u));
    actions.appendChild(banBtn);

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'admin-user-delete-btn';
    delBtn.textContent = '🗑';
    delBtn.title = t('admin.delete_user');
    delBtn.addEventListener('click', () => void deleteUser(u));
    actions.appendChild(delBtn);

    const impBtn = document.createElement('button');
    impBtn.type = 'button';
    impBtn.className = 'admin-role-btn admin-role-btn--impersonate';
    impBtn.textContent = `↬ ${t('admin.impersonate')}`;
    impBtn.title = t('admin.impersonate_title');
    impBtn.addEventListener('click', () => void impersonateUser(u));
    actions.appendChild(impBtn);

    card.appendChild(actions);
    return card;
}

/**
 * Имперсонация: выпускаем токен целевого пользователя на сервере,
 * сохраняем его сессию и догружаем роли через /me, затем уходим домой.
 */
async function impersonateUser(u: AdminUser): Promise<void> {
    const label = u.username || u.email;
    if (!confirm(t('admin.impersonate_confirm', { user: label }))) return;

    try {
        const res = await apiRequest<{ access_token: string; refresh_token: string }>(
            `/api/admin/users/${u.id}/impersonate`,
            { method: 'POST', token: state.token }
        );

        // Догружаем роли/username через /me новым токеном
        const me = await apiRequest<{
            user: {
                id: string; email: string; username: string | null;
                is_moderator: boolean; is_admin: boolean; is_ghost: boolean;
                can_rate: boolean; player_id: number | null; player_name: string | null;
            };
        }>('/api/auth/me', { token: res.access_token });

        saveSession(
            {
                id: me.user.id,
                email: me.user.email,
                username: me.user.username,
                is_moderator: me.user.is_moderator,
                is_admin: me.user.is_admin,
                is_ghost: me.user.is_ghost,
                can_rate: me.user.can_rate,
                player_id: me.user.player_id ?? null,
                player_name: me.user.player_name ?? null,
            },
            res.access_token,
            res.refresh_token
        );

        navigateTo('/', true);
    } catch (err) {
        alert(t('admin.impersonate_error') + (err instanceof Error ? err.message : String(err)));
    }
}

async function toggleRole(user: AdminUser, role: Role, currentlyHas: boolean): Promise<void> {
    const action = currentlyHas ? 'revoke' : 'grant';
    const roleName = role === 'admin' ? 'ADMIN' : role === 'ghost' ? 'GHOST' : 'MOD';

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

async function toggleCanRate(user: AdminUser): Promise<void> {
    const next = !user.can_rate;
    const label = user.username || user.email;
    const confirmText = next
        ? t('admin.enable_rate_confirm', { user: label })
        : t('admin.disable_rate_confirm', { user: label });
    if (!confirm(confirmText)) return;

    try {
        await apiRequest(`/api/admin/users/${user.id}/can-rate`, {
            method: 'POST',
            token: state.token,
            body: { canRate: next },
        });
        await loadUsers(searchInput?.value ?? '');
    } catch (err) {
        alert(t('admin.rate_toggle_error') + (err instanceof Error ? err.message : String(err)));
    }
}

async function toggleBan(user: AdminUser): Promise<void> {
    const label = user.username || user.email;
    const banning = !user.banned_at;
    if (!confirm(t(banning ? 'admin.ban_confirm' : 'admin.unban_confirm', { user: label }))) return;

    try {
        await apiRequest(`/api/admin/users/${user.id}/${banning ? 'ban' : 'unban'}`, {
            method: 'POST',
            token: state.token,
        });
        await loadUsers(searchInput?.value ?? '');
    } catch (err) {
        alert(t('admin.ban_error') + (err instanceof Error ? err.message : String(err)));
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
// Архив удалённых оценок
// ============================================================
async function loadArchive(): Promise<void> {
    if (!archiveBox) return;
    archiveBox.innerHTML = '<div class="skeleton skeleton-block"></div>';

    const q = archiveSearchInput?.value.trim() ?? '';
    const url = q
        ? `/api/admin/ratings/archive?q=${encodeURIComponent(q)}&limit=200`
        : '/api/admin/ratings/archive?limit=200';

    try {
        const res = await apiRequest<AdminArchiveResponse>(url, { token: state.token });
        renderArchive(res.archived, res.total);
    } catch (err) {
        archiveBox.innerHTML = `<p class="error">${t('common.error')}: ${err instanceof Error ? err.message : String(err)
            }</p>`;
    }
}

function renderArchive(rows: AdminArchivedRating[], total: number): void {
    if (!archiveBox) return;
    archiveBox.innerHTML = '';

    const head = document.createElement('div');
    head.className = 'admin-archive-total';
    head.textContent = t('admin.archive_total', { n: total });
    archiveBox.appendChild(head);

    if (rows.length === 0) {
        const p = document.createElement('p');
        p.className = 'hint';
        p.textContent = t('admin.archive_empty');
        archiveBox.appendChild(p);
        return;
    }

    for (const r of rows) {
        const row = document.createElement('div');
        row.className = 'admin-archive-row';

        const info = document.createElement('div');
        info.className = 'admin-archive-info';

        const who = document.createElement('div');
        who.className = 'admin-archive-who';
        who.textContent = `${r.user_name ?? r.user_id} → ${r.player_name ?? r.player_id}`;

        const statLine = document.createElement('div');
        statLine.className = 'admin-archive-stats';
        statLine.textContent =
            `${r.race} · A${r.adaptiveness} G${r.greed} S${r.survival} T${r.turtle} X${r.aggression} V${r.variety}`;

        const when = document.createElement('div');
        when.className = 'admin-archive-when';
        when.textContent = `${t('admin.archive_deleted')}: ${new Date(r.deleted_at).toLocaleString()}`;

        info.append(who, statLine, when);
        row.appendChild(info);

        const actions = document.createElement('div');
        actions.className = 'admin-archive-actions';

        const restoreBtn = document.createElement('button');
        restoreBtn.type = 'button';
        restoreBtn.className = 'btn-secondary';
        restoreBtn.textContent = `↩ ${t('admin.archive_restore')}`;
        restoreBtn.addEventListener('click', () => void restoreRating(r));
        actions.appendChild(restoreBtn);

        const restoreAllBtn = document.createElement('button');
        restoreAllBtn.type = 'button';
        restoreAllBtn.className = 'btn-secondary';
        restoreAllBtn.textContent = `↩ ${t('admin.archive_restore_all')}`;
        restoreAllBtn.title = t('admin.archive_restore_all_title');
        restoreAllBtn.addEventListener('click', () => void restoreUserRatings(r.user_id));
        actions.appendChild(restoreAllBtn);

        row.appendChild(actions);
        archiveBox.appendChild(row);
    }
}

async function restoreRating(r: AdminArchivedRating): Promise<void> {
    if (!confirm(t('admin.archive_restore_confirm'))) return;
    try {
        await apiRequest(`/api/admin/ratings/${r.id}/restore`, {
            method: 'POST',
            token: state.token,
        });
        await loadArchive();
    } catch (err) {
        alert(t('admin.archive_restore_error') + (err instanceof Error ? err.message : String(err)));
    }
}

async function restoreUserRatings(userId: string): Promise<void> {
    if (!confirm(t('admin.archive_restore_all_confirm'))) return;
    try {
        await apiRequest(`/api/admin/ratings/archive/restore-user/${encodeURIComponent(userId)}`, {
            method: 'POST',
            token: state.token,
        });
        await loadArchive();
    } catch (err) {
        alert(t('admin.archive_restore_error') + (err instanceof Error ? err.message : String(err)));
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
            linked.textContent = `🔗 ${p.username || t('admin.linked_player')}`;
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

    const isDeletedMap = config.type === 'maps' && !!(item as GameMap).deleted_at;
    if (isDeletedMap) card.classList.add('is-deleted');

    // --- Название (редактируемое) ---
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'admin-ref-input';
    nameInput.value = item.name;
    card.appendChild(nameInput);

    if (isDeletedMap) {
        const badge = document.createElement('span');
        badge.className = 'admin-ref-deleted-badge';
        badge.textContent = t('admin.map_deleted_badge');
        card.appendChild(badge);
    }

    // --- Доп. поля ---
    const extraInputs: Record<string, HTMLInputElement | HTMLSelectElement> = {};

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
        } else if (field === 'alt_name') {
            input.type = 'text';
            input.value = (item as GameMap).alt_name ?? '';
            input.placeholder = t('admin.alt_name_placeholder');
        } else if (field === 'player_id') {
            // Ведущий → привязка к игроку (стример): выбор из списка игроков
            const select = document.createElement('select');
            select.className = 'admin-ref-input';
            select.title = t('admin.host_player_title');

            const none = document.createElement('option');
            none.value = '';
            none.textContent = t('admin.host_player_none');
            select.appendChild(none);

            for (const p of cachedPlayers) {
                const opt = document.createElement('option');
                opt.value = String(p.id);
                opt.textContent = p.name;
                if (p.id === (item as GameHost).player_id) opt.selected = true;
                select.appendChild(opt);
            }

            extraInputs[field] = select;
            card.appendChild(select);
            continue;
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
    if (isDeletedMap) {
        delBtn.textContent = '↩';
        delBtn.title = t('admin.restore');
        delBtn.classList.add('admin-ref-btn--restore');
        delBtn.addEventListener('click', () => {
            void restoreRefItem(config, item);
        });
    } else {
        delBtn.textContent = '🗑';
        delBtn.title = t('common.delete');
        delBtn.addEventListener('click', () => {
            void deleteRefItem(config, item);
        });
    }
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
    extraInputs: Record<string, HTMLInputElement | HTMLSelectElement>
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
        else if (field === 'alt_name') payload.alt_name = input.value.trim() || null;
        else if (field === 'player_id') {
            payload.player_id = input.value ? Number(input.value) : null;
        }
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

async function restoreRefItem(config: RefConfig, item: RefItem): Promise<void> {
    try {
        await updateRef(config.type, item.id, { deleted_at: null }, state.token);
        await loadRefs(config);
    } catch (err) {
        alert(t('common.error') + ': ' + (err instanceof Error ? err.message : String(err)));
    }
}

// ============================================================
// Титулы
// ============================================================
async function loadTitles(): Promise<void> {
    if (!titlesBox) return;
    titlesBox.innerHTML = '<div class="skeleton skeleton-block"></div>';

    try {
        const res = await apiRequest<{ items: AdminTitle[] }>('/api/titles');
        renderTitles(res.items);
    } catch (err) {
        titlesBox.innerHTML = `<p class="error">${t('common.error')}: ${err instanceof Error ? err.message : String(err)
            }</p>`;
    }
}

function renderTitles(titles: AdminTitle[]): void {
    if (!titlesBox) return;

    if (titles.length === 0) {
        titlesBox.innerHTML = `<p class="hint">${t('admin.titles_empty')}</p>`;
        return;
    }

    titlesBox.innerHTML = '';
    for (const title of titles) {
        titlesBox.appendChild(buildTitleCard(title));
    }
}

function buildTitleCard(title: AdminTitle): HTMLElement {
    const card = document.createElement('div');
    card.className = 'admin-title-card';

    // --- Текст титула ---
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'admin-ref-input';
    nameInput.value = title.name;
    card.appendChild(nameInput);

    // --- Палитра цветов ---
    let selectedColor = title.color;
    const swatches = document.createElement('div');
    swatches.className = 'title-swatches';
    for (const c of TITLE_COLORS) {
        const sw = document.createElement('button');
        sw.type = 'button';
        sw.className = 'title-swatch' + (c.value.toLowerCase() === selectedColor.toLowerCase() ? ' is-active' : '');
        sw.style.setProperty('--swatch', c.value);
        sw.title = t(c.nameKey as any);
        sw.addEventListener('click', () => {
            selectedColor = c.value;
            for (const s of swatches.querySelectorAll('.title-swatch')) s.classList.remove('is-active');
            sw.classList.add('is-active');
        });
        swatches.appendChild(sw);
    }
    card.appendChild(swatches);

    // --- Размер бейджа ---
    let selectedSize = title.size ?? 'small';
    const sizeRow = document.createElement('div');
    sizeRow.className = 'title-size-row';
    const sizeLabel = document.createElement('span');
    sizeLabel.className = 'title-size-label';
    sizeLabel.textContent = t('title.size_label');
    const sizeSelect = document.createElement('select');
    sizeSelect.className = 'admin-ref-input';
    for (const s of TITLE_SIZES) {
        const opt = document.createElement('option');
        opt.value = s;
        opt.textContent = t(`title.size_${s}` as any);
        if (s === selectedSize) opt.selected = true;
        sizeSelect.appendChild(opt);
    }
    sizeSelect.addEventListener('change', () => { selectedSize = sizeSelect.value as TitleSize; });
    sizeRow.append(sizeLabel, sizeSelect);
    card.appendChild(sizeRow);

    // --- Назначенные игроки ---
    const playersEl = document.createElement('div');
    playersEl.className = 'title-players';

    const assigned = title.player_ids
        .map((id) => cachedPlayers.find((p) => p.id === id))
        .filter((p): p is PlayerWithStats => !!p);

    if (assigned.length > 0) {
        for (const p of assigned) {
            const chip = document.createElement('span');
            chip.className = 'title-player-chip';
            chip.textContent = p.name;

            const removeBtn = document.createElement('button');
            removeBtn.type = 'button';
            removeBtn.className = 'title-player-remove';
            removeBtn.textContent = '×';
            removeBtn.title = t('admin.title_unassign');
            removeBtn.addEventListener('click', () => {
                void unassignPlayerFromTitle(title.id, p.id);
            });
            chip.appendChild(removeBtn);
            playersEl.appendChild(chip);
        }
    }

    // --- Добавить игрока ---
    const addRow = document.createElement('div');
    addRow.className = 'title-add-player';

    const select = document.createElement('select');
    select.className = 'admin-ref-input';
    const none = document.createElement('option');
    none.value = '';
    none.textContent = t('admin.title_select_player');
    select.appendChild(none);
    for (const p of cachedPlayers) {
        if (title.player_ids.includes(p.id)) continue;
        const opt = document.createElement('option');
        opt.value = String(p.id);
        opt.textContent = p.name;
        select.appendChild(opt);
    }
    addRow.appendChild(select);

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'btn-secondary';
    addBtn.textContent = t('admin.title_add_player');
    addBtn.addEventListener('click', () => {
        const pid = Number(select.value);
        if (!pid) return;
        void assignPlayerToTitle(title.id, pid);
    });
    addRow.appendChild(addBtn);
    playersEl.appendChild(addRow);

    card.appendChild(playersEl);

    // --- Кнопки: сохранить / удалить ---
    const actions = document.createElement('div');
    actions.className = 'admin-ref-actions';

    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'admin-ref-btn admin-ref-btn--save';
    saveBtn.textContent = '✓';
    saveBtn.title = t('common.save');
    saveBtn.addEventListener('click', () => {
        void saveTitle(title.id, nameInput.value, selectedColor, selectedSize);
    });
    actions.appendChild(saveBtn);

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'admin-ref-btn admin-ref-btn--delete';
    delBtn.textContent = '🗑';
    delBtn.title = t('common.delete');
    delBtn.addEventListener('click', () => {
        void deleteTitle(title);
    });
    actions.appendChild(delBtn);

    card.appendChild(actions);
    return card;
}

async function createTitle(): Promise<void> {
    const name = prompt(t('admin.new_title_prompt'));
    if (name === null) return;
    const trimmed = name.trim();
    if (!trimmed) return;

    try {
        await apiRequest('/api/titles', {
            method: 'POST',
            token: state.token,
            body: { name: trimmed, color: TITLE_COLORS[0].value },
        });
        await loadTitles();
    } catch (err) {
        alert(t('admin.new_title_error') + (err instanceof Error ? err.message : String(err)));
    }
}

async function saveTitle(id: number, name: string, color: string, size: TitleSize): Promise<void> {
    const trimmed = name.trim();
    if (!trimmed) {
        alert(t('common.error') + ': name is empty');
        return;
    }
    try {
        await apiRequest(`/api/titles/${id}`, {
            method: 'PATCH',
            token: state.token,
            body: { name: trimmed, color, size },
        });
        await loadTitles();
    } catch (err) {
        alert(t('common.error') + ': ' + (err instanceof Error ? err.message : String(err)));
    }
}

async function deleteTitle(title: AdminTitle): Promise<void> {
    if (!confirm(t('admin.delete_title_confirm', { name: title.name }))) return;
    try {
        await apiRequest(`/api/titles/${title.id}`, {
            method: 'DELETE',
            token: state.token,
        });
        await loadTitles();
    } catch (err) {
        alert(t('common.error') + ': ' + (err instanceof Error ? err.message : String(err)));
    }
}

async function assignPlayerToTitle(titleId: number, playerId: number): Promise<void> {
    try {
        await apiRequest(`/api/titles/${titleId}/players`, {
            method: 'POST',
            token: state.token,
            body: { playerId },
        });
        await loadTitles();
    } catch (err) {
        alert(t('common.error') + ': ' + (err instanceof Error ? err.message : String(err)));
    }
}

async function unassignPlayerFromTitle(titleId: number, playerId: number): Promise<void> {
    try {
        await apiRequest(`/api/titles/${titleId}/players/${playerId}`, {
            method: 'DELETE',
            token: state.token,
        });
        await loadTitles();
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

// ============================================================
// Лог действий
// ============================================================
function populateLogActionOptions(): void {
    if (!logsActionSelect) return;
    while (logsActionSelect.options.length > 1) logsActionSelect.remove(1);
    for (const a of LOG_ACTIONS) {
        const opt = document.createElement('option');
        opt.value = a.value;
        opt.textContent = t(a.key as any);
        logsActionSelect.appendChild(opt);
    }
}

async function loadLogs(showSpinner = false): Promise<void> {
    if (!logsBox) return;
    if (showSpinner) logsBox.innerHTML = '<div class="skeleton skeleton-block"></div>';

    const params = new URLSearchParams();
    const q = logsSearchInput?.value.trim() ?? '';
    const action = logsActionSelect?.value ?? '';
    if (q) params.set('q', q);
    if (action) params.set('action', action);
    params.set('limit', '200');

    try {
        const res = await apiRequest<AdminLogsResponse>(
            `/api/admin/logs?${params.toString()}`,
            { token: state.token }
        );
        renderLogs(res.logs);
    } catch (err) {
        logsBox.innerHTML = `<p class="error">${t('common.error')}: ${err instanceof Error ? err.message : String(err)
            }</p>`;
    }
}

function renderLogs(logs: AdminLog[]): void {
    if (!logsBox) return;

    if (logs.length === 0) {
        logsBox.innerHTML = `<p class="hint">${t('admin.logs_empty')}</p>`;
        return;
    }

    logsBox.innerHTML = '';
    for (const log of logs) {
        logsBox.appendChild(buildLogRow(log));
    }
}

function buildLogRow(log: AdminLog): HTMLElement {
    const row = document.createElement('div');
    row.className = 'admin-log-row';

    const d = new Date(log.created_at);

    const time = document.createElement('div');
    time.className = 'admin-log-time';
    time.textContent = d.toLocaleString(getLocale() === 'ru' ? 'ru-RU' : 'en-US', {
        day: '2-digit', month: '2-digit', year: '2-digit',
        hour: '2-digit', minute: '2-digit',
    });
    time.title = d.toLocaleString();

    const actor = document.createElement('div');
    actor.className = 'admin-log-actor';
    actor.textContent = log.actor_username
        || (log.actor_id ? log.actor_id.slice(0, 8) : t('admin.logs_system'));
    if (!log.actor_username && log.actor_id) actor.title = log.actor_id;

    const badge = document.createElement('span');
    const prefix = log.action.split('.')[0];
    badge.className = `admin-log-badge admin-log-badge--${prefix}`;
    badge.textContent = actionLabel(log.action);

    const summary = document.createElement('div');
    summary.className = 'admin-log-summary';
    summary.textContent = log.summary;

    row.append(time, actor, badge, summary);
    return row;
}

function actionLabel(action: string): string {
    const key = LOG_ACTION_LABELS[action];
    return key ? t(key as any) : action;
}

function relativeTime(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    if (diff < 0) return t('admin.last_seen_just_now');
    const min = Math.floor(diff / 60000);
    if (min < 1) return t('admin.last_seen_just_now');
    if (min < 60) return t('admin.last_seen_minutes', { n: String(min) });
    const h = Math.floor(min / 60);
    if (h < 24) return t('admin.last_seen_hours', { n: String(h) });
    const d = Math.floor(h / 24);
    return t('admin.last_seen_days', { n: String(d) });
}