import { Router } from 'express';
import { authenticate } from '../../lib/auth.js';
import { supabaseAdmin } from '../../lib/supabase-admin.js';
import { logAction } from '../../lib/action-log.js';
import { archiveRatings } from '../../lib/ratings-archive.js';

export const adminRouter = Router();

const ALLOWED_ROLES = ['moderator', 'admin', 'ghost'] as const;
type Role = (typeof ALLOWED_ROLES)[number];

/**
 * Middleware: только для админов.
 */
adminRouter.use(async (req, res, next) => {
    const auth = await authenticate(req);
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

    const { data: isAdmin } = await auth.client.rpc('is_admin');
    if (!isAdmin) {
        return res.status(403).json({ error: 'Admin access required' });
    }

    (req as any).userId = auth.user.id;
    next();
});

// ============================================================
// GET /api/admin/logs?q=...&action=...&limit=...&offset=...
// Лог действий на сайте (только для админов)
// ============================================================
adminRouter.get('/logs', async (req, res) => {
    const q = String(req.query.q ?? '').trim();
    const action = String(req.query.action ?? '').trim();
    const limit = Math.min(Math.max(Number(req.query.limit ?? 100) || 100, 1), 500);
    const offset = Math.max(Number(req.query.offset ?? 0) || 0, 0);

    let query = supabaseAdmin
        .from('action_log')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

    if (action) query = query.eq('action', action);

    if (q) {
        // Экранируем спецсимволы PostgREST-фильтра, оставляя простой поиск
        const safe = q.replace(/[(),%*\\]/g, ' ').trim();
        if (safe) {
            query = query.or(
                `summary.ilike.%${safe}%,actor_username.ilike.%${safe}%`
            );
        }
    }

    const { data, error, count } = await query;

    if (error) {
        console.error('[admin/logs] error:', error);
        // Отдаём админу реальную причину (роут доступен только админам)
        return res.status(500).json({
            error: `DB error: ${error.message}`,
            code: error.code,
            hint: error.hint,
        });
    }

    res.json({ logs: data ?? [], total: count ?? 0 });
});

// ============================================================
// GET /api/admin/users?q=...
// Список всех пользователей с ролями (с опциональным поиском)
// ============================================================
adminRouter.get('/users', async (req, res) => {
    const q = String(req.query.q ?? '').trim().toLowerCase();

    // Получаем пользователей и их профили
    const { data: users, error: usersErr } = await supabaseAdmin
        .from('profiles')
        .select('user_id, username, created_at, can_rate, banned_at');

    if (usersErr) {
        console.error('[admin/users] profiles error:', usersErr);
        return res.status(500).json({ error: 'DB error' });
    }

    // Получаем email'ы из auth.users через admin API
    const { data: authList, error: authErr } =
        await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 });

    if (authErr) {
        console.error('[admin/users] auth list error:', authErr);
        return res.status(500).json({ error: 'Auth error' });
    }

    // Получаем все роли
    const { data: roles, error: rolesErr } = await supabaseAdmin
        .from('user_roles')
        .select('user_id, role, granted_at');

    if (rolesErr) {
        console.error('[admin/users] roles error:', rolesErr);
        return res.status(500).json({ error: 'DB error' });
    }

    // Получаем привязанные игроки (players.user_id)
    const { data: linkedPlayers, error: linkedErr } = await supabaseAdmin
        .from('players')
        .select('user_id, name')
        .not('user_id', 'is', null);

    if (linkedErr) {
        console.error('[admin/users] players error:', linkedErr);
        return res.status(500).json({ error: 'DB error' });
    }

    // Карта: user_id -> имя игрока
    const playerByUser = new Map<string, string>();
    for (const p of linkedPlayers ?? []) {
        if (p.user_id) playerByUser.set(p.user_id, p.name);
    }

    // Собираем карту ролей
    const rolesByUser = new Map<string, { role: Role; granted_at: string }[]>();
    for (const r of roles ?? []) {
        const list = rolesByUser.get(r.user_id) ?? [];
        list.push({ role: r.role as Role, granted_at: r.granted_at });
        rolesByUser.set(r.user_id, list);
    }

    // Собираем карту профилей
    const profileByUser = new Map<string, { username: string | null; created_at: string; can_rate: boolean; banned_at: string | null }>();
    for (const p of users ?? []) {
        profileByUser.set(p.user_id, {
            username: p.username,
            created_at: p.created_at,
            can_rate: p.can_rate !== false,
            banned_at: p.banned_at ?? null,
        });
    }

    // Объединяем
    const result = (authList?.users ?? []).map((u) => {
        const profile = profileByUser.get(u.id);
        return {
            id: u.id,
            email: u.email ?? '',
            username: profile?.username ?? null,
            created_at: u.created_at ?? profile?.created_at ?? null,
            last_seen_at: u.last_sign_in_at ?? null,
            roles: (rolesByUser.get(u.id) ?? []).map((r) => r.role),
            player_name: playerByUser.get(u.id) ?? null,
            can_rate: profile?.can_rate ?? true,
            banned_at: profile?.banned_at ?? null,
        };
    });

    // Фильтруем по поиску
    const filtered = q
        ? result.filter((u) => {
            const hay = `${u.email} ${u.username ?? ''} ${u.player_name ?? ''}`.toLowerCase();
            return hay.includes(q);
        })
        : result;

    // Сортируем:
    // 1. Сначала с ролями (админы/модеры) — сверху
    // 2. Внутри группы — по дате регистрации (от новых к старым)
    filtered.sort((a, b) => {
        const aHas = a.roles.length > 0 ? 1 : 0;
        const bHas = b.roles.length > 0 ? 1 : 0;
        if (aHas !== bHas) return bHas - aHas;

        // По дате регистрации (от новых к старым)
        const aTime = a.created_at ? new Date(a.created_at).getTime() : 0;
        const bTime = b.created_at ? new Date(b.created_at).getTime() : 0;
        return bTime - aTime;
    });

    res.json({ users: filtered });
});

// ============================================================
// POST /api/admin/roles/grant
// { userId, role }
// ============================================================
adminRouter.post('/roles/grant', async (req, res) => {
    const { userId, role } = req.body ?? {};
    const grantedBy = (req as any).userId as string;

    if (typeof userId !== 'string' || !userId) {
        return res.status(400).json({ error: 'userId is required' });
    }
    if (!ALLOWED_ROLES.includes(role)) {
        return res.status(400).json({ error: `role must be one of: ${ALLOWED_ROLES.join(', ')}` });
    }

    const { error } = await supabaseAdmin
        .from('user_roles')
        .upsert(
            { user_id: userId, role, granted_by: grantedBy },
            { onConflict: 'user_id,role' }
        );

    if (error) {
        console.error('[admin/roles/grant] error:', error);
        return res.status(500).json({ error: 'DB error' });
    }

    const { data: targetProfile } = await supabaseAdmin
        .from('profiles')
        .select('username')
        .eq('user_id', userId)
        .maybeSingle();

    void logAction({
        action: 'role.grant',
        actorId: grantedBy,
        entityType: 'user',
        summary: `Выдана роль ${role} пользователю ${targetProfile?.username ?? userId}`,
        details: { role, targetUserId: userId },
    });

    res.json({ ok: true });
});

// ============================================================
// POST /api/admin/roles/revoke
// { userId, role }
// ============================================================
adminRouter.post('/roles/revoke', async (req, res) => {
    const { userId, role } = req.body ?? {};
    const actorId = (req as any).userId as string;

    if (typeof userId !== 'string' || !userId) {
        return res.status(400).json({ error: 'userId is required' });
    }
    if (!ALLOWED_ROLES.includes(role)) {
        return res.status(400).json({ error: `role must be one of: ${ALLOWED_ROLES.join(', ')}` });
    }

    const { error } = await supabaseAdmin
        .from('user_roles')
        .delete()
        .eq('user_id', userId)
        .eq('role', role);

    if (error) {
        console.error('[admin/roles/revoke] error:', error);
        return res.status(500).json({ error: 'DB error' });
    }

    const { data: targetProfile } = await supabaseAdmin
        .from('profiles')
        .select('username')
        .eq('user_id', userId)
        .maybeSingle();

    void logAction({
        action: 'role.revoke',
        actorId,
        entityType: 'user',
        summary: `Снята роль ${role} с пользователя ${targetProfile?.username ?? userId}`,
        details: { role, targetUserId: userId },
    });

    res.json({ ok: true });
});

// ============================================================
// POST /api/admin/users/:id/can-rate
// { canRate: boolean }
// Выдать/запретить пользователю возможность ставить оценки
// ============================================================
adminRouter.post('/users/:id/can-rate', async (req, res) => {
    const userId = req.params.id;
    if (!userId || typeof userId !== 'string') {
        return res.status(400).json({ error: 'Invalid user id' });
    }

    const canRate = req.body?.canRate;
    if (typeof canRate !== 'boolean') {
        return res.status(400).json({ error: 'canRate (boolean) is required' });
    }

    const actorId = (req as any).userId as string;

    const { data, error } = await supabaseAdmin
        .from('profiles')
        .update({ can_rate: canRate })
        .eq('user_id', userId)
        .select('user_id, can_rate')
        .maybeSingle();

    if (error) {
        console.error('[admin/users/can-rate] error:', error);
        return res.status(500).json({ error: 'DB error' });
    }
    if (!data) {
        return res.status(404).json({ error: 'User not found' });
    }

    const { data: targetProfile } = await supabaseAdmin
        .from('profiles')
        .select('username')
        .eq('user_id', userId)
        .maybeSingle();

    void logAction({
        action: canRate ? 'user.rate_allow' : 'user.rate_block',
        actorId,
        entityType: 'user',
        summary: `${canRate ? 'Оценки снова учитываются в средних' : 'Оценки исключены из средних'} пользователя ${targetProfile?.username ?? userId}`,
        details: { targetUserId: userId, canRate },
    });

    res.json({ ok: true, can_rate: data.can_rate });
});

// ============================================================
// POST /api/admin/users/:id/ban
// Заблокировать аккаунт: ставит banned_at (блокирует вход и все
// авторизованные запросы) и отключает право оценивать.
// ============================================================
adminRouter.post('/users/:id/ban', async (req, res) => {
    const userId = req.params.id;
    if (!userId || typeof userId !== 'string') {
        return res.status(400).json({ error: 'Invalid user id' });
    }

    const actorId = (req as any).userId as string;

    const { data, error } = await supabaseAdmin
        .from('profiles')
        .update({ banned_at: new Date().toISOString(), can_rate: false })
        .eq('user_id', userId)
        .select('user_id, banned_at')
        .maybeSingle();

    if (error) {
        console.error('[admin/users/ban] error:', error);
        return res.status(500).json({ error: 'DB error' });
    }
    if (!data) {
        return res.status(404).json({ error: 'User not found' });
    }

    const { data: targetProfile } = await supabaseAdmin
        .from('profiles')
        .select('username')
        .eq('user_id', userId)
        .maybeSingle();

    void logAction({
        action: 'user.ban',
        actorId,
        entityType: 'user',
        summary: `Заблокирован пользователь ${targetProfile?.username ?? userId}`,
        details: { targetUserId: userId },
    });

    res.json({ ok: true, banned_at: data.banned_at });
});

// ============================================================
// POST /api/admin/users/:id/unban
// Разблокировать аккаунт: снимает banned_at и восстанавливает
// право оценивать.
// ============================================================
adminRouter.post('/users/:id/unban', async (req, res) => {
    const userId = req.params.id;
    if (!userId || typeof userId !== 'string') {
        return res.status(400).json({ error: 'Invalid user id' });
    }

    const actorId = (req as any).userId as string;

    const { data, error } = await supabaseAdmin
        .from('profiles')
        .update({ banned_at: null, can_rate: true })
        .eq('user_id', userId)
        .select('user_id, banned_at')
        .maybeSingle();

    if (error) {
        console.error('[admin/users/unban] error:', error);
        return res.status(500).json({ error: 'DB error' });
    }
    if (!data) {
        return res.status(404).json({ error: 'User not found' });
    }

    const { data: targetProfile } = await supabaseAdmin
        .from('profiles')
        .select('username')
        .eq('user_id', userId)
        .maybeSingle();

    void logAction({
        action: 'user.unban',
        actorId,
        entityType: 'user',
        summary: `Разблокирован пользователь ${targetProfile?.username ?? userId}`,
        details: { targetUserId: userId },
    });

    res.json({ ok: true, banned_at: data.banned_at });
});

// ============================================================
// POST /api/admin/users/:id/impersonate
// Войти под любым пользователем (имперсонация). В GoTrue нет готового
// «создать сессию» эндпоинта, поэтому:
//   1) генерируем magiclink через admin API (generate_link — email НЕ шлёт);
//   2) переходим по action_link (verify) с redirect:manual — сессия
//      (access/refresh токен) возвращается во фрагменте Location.
// ============================================================
adminRouter.post('/users/:id/impersonate', async (req, res) => {
    const userId = req.params.id;
    if (!userId || typeof userId !== 'string') {
        return res.status(400).json({ error: 'Invalid user id' });
    }

    const actorId = (req as any).userId as string;

    // Забаненного нельзя брать в имперсонацию — вход ему закрыт.
    const { data: prof } = await supabaseAdmin
        .from('profiles')
        .select('username, banned_at')
        .eq('user_id', userId)
        .maybeSingle();
    if (prof?.banned_at) {
        return res.status(400).json({ error: 'User is banned' });
    }

    const url = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const headers = {
        'Content-Type': 'application/json',
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
    };

    try {
        // Нужен email целевого пользователя для magiclink.
        const { data: authUser, error: auErr } =
            await supabaseAdmin.auth.admin.getUserById(userId);
        const email = authUser?.user?.email;
        if (auErr || !email) {
            return res.status(404).json({ error: 'User not found' });
        }

        // 1. Генерируем magiclink (email не отправляется).
        const glRes = await fetch(`${url}/auth/v1/admin/generate_link`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ type: 'magiclink', email }),
        });
        const glBody = await glRes.json();
        if (!glRes.ok || !glBody?.action_link) {
            console.error('[admin/users/impersonate] generate_link error:', glBody);
            return res.status(glRes.status || 500).json({
                error: glBody?.msg || 'Failed to create session',
            });
        }

        // 2. «Проверяем» ссылку — в Location-фрагменте лежат токены.
        const verifyRes = await fetch(glBody.action_link, {
            headers: { ...headers, Accept: 'application/json' },
            redirect: 'manual',
        });
        const location = verifyRes.headers.get('location') ?? '';
        const hash = location.includes('#') ? location.split('#')[1] : '';
        const params = new URLSearchParams(hash);
        const access_token = params.get('access_token');
        const refresh_token = params.get('refresh_token');

        if (!access_token || !refresh_token) {
            console.error(
                '[admin/users/impersonate] verify failed, status=',
                verifyRes.status,
                'loc=',
                location.slice(0, 200)
            );
            return res.status(500).json({ error: 'Failed to create session' });
        }

        void logAction({
            action: 'user.impersonate',
            actorId,
            entityType: 'user',
            summary: `Имперсонация: админ вошёл под ${prof?.username ?? userId}`,
            details: { targetUserId: userId },
        });

        return res.json({
            access_token,
            refresh_token,
            expires_at: params.get('expires_at'),
        });
    } catch (err) {
        console.error('[admin/users/impersonate] fetch error:', err);
        return res.status(500).json({ error: 'Failed to create session' });
    }
});

// ============================================================
// DELETE /api/admin/ratings/:id
// Удалить любую оценку по ID (с сохранением в архив)
// ============================================================
adminRouter.delete('/ratings/:id', async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: 'Invalid rating id' });
    }

    const { data: row, error: selErr } = await supabaseAdmin
        .from('ratings')
        .select('*')
        .eq('id', id)
        .maybeSingle();

    if (selErr) {
        console.error('[admin/ratings/delete] select error:', selErr);
        return res.status(500).json({ error: 'DB error' });
    }
    if (!row) {
        return res.status(404).json({ error: 'Rating not found' });
    }

    await archiveRatings([row]);

    const { error } = await supabaseAdmin
        .from('ratings')
        .delete()
        .eq('id', id);

    if (error) {
        console.error('[admin/ratings/delete] error:', error);
        return res.status(500).json({ error: 'DB error' });
    }

    void logAction({
        action: 'rating.delete',
        actorId: (req as any).userId,
        entityType: 'rating',
        entityId: id,
        summary: `Удалена оценка #${id} (игрок #${row.player_id})`,
        details: { playerId: row.player_id, targetUserId: row.user_id },
    });

    res.json({ ok: true, deleted: row });
});

// ============================================================
// DELETE /api/admin/players/:id/ratings
// Удалить все оценки игрока (поставленные другими пользователями),
// с сохранением в архив
// ============================================================
adminRouter.delete('/players/:id/ratings', async (req, res) => {
    const playerId = Number(req.params.id);
    if (!Number.isInteger(playerId) || playerId <= 0) {
        return res.status(400).json({ error: 'Invalid player id' });
    }

    const { data: rows, error: selErr } = await supabaseAdmin
        .from('ratings')
        .select('*')
        .eq('player_id', playerId);

    if (selErr) {
        console.error('[admin/players/ratings/delete-all] select error:', selErr);
        return res.status(500).json({ error: 'DB error' });
    }

    const deleted = (rows ?? []).length;

    await archiveRatings(rows ?? []);

    const { error } = await supabaseAdmin
        .from('ratings')
        .delete()
        .eq('player_id', playerId);

    if (error) {
        console.error('[admin/players/ratings/delete-all] error:', error);
        return res.status(500).json({ error: 'DB error' });
    }

    void logAction({
        action: 'rating.delete',
        actorId: (req as any).userId,
        entityType: 'player',
        entityId: playerId,
        summary: `Удалены все оценки игрока #${playerId} (${deleted})`,
        details: { playerId, deleted },
    });

    res.json({ ok: true, deleted });
});

// ============================================================
// DELETE /api/admin/players/:id/given-ratings
// Удалить все оценки, поставленные игроком (связанным с профилем),
// с сохранением в архив
// ============================================================
adminRouter.delete('/players/:id/given-ratings', async (req, res) => {
    const playerId = Number(req.params.id);
    if (!Number.isInteger(playerId) || playerId <= 0) {
        return res.status(400).json({ error: 'Invalid player id' });
    }

    const { data: player, error: playerErr } = await supabaseAdmin
        .from('players')
        .select('id, user_id')
        .eq('id', playerId)
        .maybeSingle();

    if (playerErr) {
        console.error('[admin/players/given-ratings/delete-all] error:', playerErr);
        return res.status(500).json({ error: 'DB error' });
    }
    if (!player) return res.status(404).json({ error: 'Player not found' });
    if (!player.user_id) return res.json({ ok: true, deleted: 0 });

    const { data: rows, error: selErr } = await supabaseAdmin
        .from('ratings')
        .select('*')
        .eq('user_id', player.user_id);

    if (selErr) {
        console.error('[admin/players/given-ratings/delete-all] select error:', selErr);
        return res.status(500).json({ error: 'DB error' });
    }

    const deleted = (rows ?? []).length;

    await archiveRatings(rows ?? []);

    const { error } = await supabaseAdmin
        .from('ratings')
        .delete()
        .eq('user_id', player.user_id);

    if (error) {
        console.error('[admin/players/given-ratings/delete-all] error:', error);
        return res.status(500).json({ error: 'DB error' });
    }

    void logAction({
        action: 'rating.delete',
        actorId: (req as any).userId,
        entityType: 'player',
        entityId: playerId,
        summary: `Удалены все оценки, поставленные игроком #${playerId} (${deleted})`,
        details: { playerId, deleted },
    });

    res.json({ ok: true, deleted });
});

// ============================================================
// GET /api/admin/ratings/archive?q=&userId=&limit=&offset=
// Список удалённых оценок (из архива). Только для админов.
// ============================================================
adminRouter.get('/ratings/archive', async (req, res) => {
    const q = String(req.query.q ?? '').trim();
    const limit = Math.min(Math.max(Number(req.query.limit ?? 100) || 100, 1), 500);
    const offset = Math.max(Number(req.query.offset ?? 0) || 0, 0);

    let query = supabaseAdmin
        .from('ratings_archive')
        .select('*', { count: 'exact' })
        .order('deleted_at', { ascending: false })
        .range(offset, offset + limit - 1);

    if (q) {
        const safe = q.replace(/[(),%*\\]/g, ' ').trim();
        if (safe) query = query.or(`player_name.ilike.%${safe}%,user_name.ilike.%${safe}%`);
    }

    const { data, error, count } = await query;

    if (error) {
        console.error('[admin/ratings/archive] error:', error);
        return res.status(500).json({ error: `DB error: ${error.message}` });
    }

    res.json({ archived: data ?? [], total: count ?? 0 });
});

// ============================================================
// POST /api/admin/ratings/:archiveId/restore
// Восстановить одну оценку из архива в ratings.
// ============================================================
adminRouter.post('/ratings/:archiveId/restore', async (req, res) => {
    const archiveId = Number(req.params.archiveId);
    if (!Number.isInteger(archiveId) || archiveId <= 0) {
        return res.status(400).json({ error: 'Invalid archive id' });
    }

    const { data: row, error: getErr } = await supabaseAdmin
        .from('ratings_archive')
        .select('*')
        .eq('id', archiveId)
        .maybeSingle();

    if (getErr) {
        console.error('[admin/ratings/restore] get error:', getErr);
        return res.status(500).json({ error: 'DB error' });
    }
    if (!row) return res.status(404).json({ error: 'Archive entry not found' });

    const restored = await restoreArchivedRows([row]);
    if (restored.error) {
        return res.status(500).json({ error: 'DB error' });
    }

    await supabaseAdmin.from('ratings_archive').delete().eq('id', archiveId);

    void logAction({
        action: 'rating.restore',
        actorId: (req as any).userId,
        entityType: 'rating',
        entityId: row.original_id,
        summary: `Восстановлена оценка #${row.original_id} (игрок #${row.player_id})`,
        details: { playerId: row.player_id, targetUserId: row.user_id },
    });

    res.json({ ok: true });
});

// ============================================================
// POST /api/admin/ratings/archive/restore-user/:userId
// Восстановить все удалённые оценки конкретного пользователя.
// ============================================================
adminRouter.post('/ratings/archive/restore-user/:userId', async (req, res) => {
    const userId = req.params.userId;
    if (!userId || typeof userId !== 'string') {
        return res.status(400).json({ error: 'Invalid user id' });
    }

    const { data: rows, error: getErr } = await supabaseAdmin
        .from('ratings_archive')
        .select('*')
        .eq('user_id', userId);

    if (getErr) {
        console.error('[admin/ratings/restore-user] get error:', getErr);
        return res.status(500).json({ error: 'DB error' });
    }

    const restored = await restoreArchivedRows(rows ?? []);
    if (restored.error) {
        return res.status(500).json({ error: 'DB error' });
    }

    const ids = (rows ?? []).map((r) => r.id);
    if (ids.length > 0) {
        await supabaseAdmin.from('ratings_archive').delete().in('id', ids);
    }

    void logAction({
        action: 'rating.restore',
        actorId: (req as any).userId,
        entityType: 'user',
        summary: `Восстановлены все удалённые оценки пользователя ${userId} (${ids.length})`,
        details: { targetUserId: userId, restored: ids.length },
    });

    res.json({ ok: true, restored: ids.length });
});

/** Переносит строки архива обратно в ratings (upsert по player_id,user_id). */
async function restoreArchivedRows(
    rows: Array<Record<string, unknown>>
): Promise<{ error?: boolean }> {
    if (!rows || rows.length === 0) return {};

    const payload = rows.map((r) => ({
        player_id: r.player_id,
        user_id: r.user_id,
        race: r.race,
        adaptiveness: r.adaptiveness,
        greed: r.greed,
        survival: r.survival,
        turtle: r.turtle,
        aggression: r.aggression,
        variety: r.variety,
    }));

    const { error } = await supabaseAdmin
        .from('ratings')
        .upsert(payload, { onConflict: 'player_id,user_id' });

    if (error) {
        console.error('[admin/ratings/restore] upsert error:', error);
        return { error: true };
    }
    return {};
}

// ============================================================
// GET /api/admin/players/:id/ratings
// Все оценки игрока (для админ-панели)
// ============================================================
adminRouter.get('/players/:id/ratings', async (req, res) => {
    const playerId = Number(req.params.id);
    if (!Number.isInteger(playerId) || playerId <= 0) {
        return res.status(400).json({ error: 'Invalid player id' });
    }

    const { data: ratings, error: ratingsErr } = await supabaseAdmin
        .from('ratings')
        .select('id, user_id, race, adaptiveness, greed, survival, turtle, aggression, variety, created_at, updated_at')
        .eq('player_id', playerId)
        .order('created_at', { ascending: true });

    if (ratingsErr) {
        console.error('[admin/players/ratings] error:', ratingsErr);
        return res.status(500).json({ error: 'DB error' });
    }

    // Подтягиваем email/username для каждого user_id
    const userIds = [...new Set((ratings ?? []).map((r) => r.user_id))];
    const userInfo = new Map<string, { email: string; username: string | null }>();

    if (userIds.length > 0) {
        const { data: profiles } = await supabaseAdmin
            .from('profiles')
            .select('user_id, username')
            .in('user_id', userIds);

        const { data: authList } = await supabaseAdmin.auth.admin.listUsers({
            perPage: 1000,
        });

        for (const u of authList?.users ?? []) {
            if (userIds.includes(u.id)) {
                const profile = profiles?.find((p) => p.user_id === u.id);
                userInfo.set(u.id, {
                    email: u.email ?? '',
                    username: profile?.username ?? null,
                });
            }
        }
    }

    const result = (ratings ?? []).map((r) => {
        const info = userInfo.get(r.user_id);
        return {
            ...r,
            email: info?.email ?? '',
            username: info?.username ?? null,
        };
    });

    res.json({ ratings: result });
});

// ============================================================
// PATCH /api/admin/players/:id/aka
// Обновить aka игрока (только админ)
// ============================================================
adminRouter.patch('/players/:id/aka', async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: 'Invalid player id' });
    }

    const aka = req.body?.aka;
    if (aka !== null && typeof aka !== 'string') {
        return res.status(400).json({ error: 'aka must be a string or null' });
    }

    const trimmed = typeof aka === 'string' ? aka.trim() : null;
    if (trimmed && trimmed.length > 100) {
        return res.status(400).json({ error: 'aka is too long (max 100)' });
    }

    const { data, error } = await supabaseAdmin
        .from('players')
        .update({ aka: trimmed || null })
        .eq('id', id)
        .select()
        .maybeSingle();

    if (error) {
        console.error('[admin/players/aka] error:', error);
        return res.status(500).json({ error: 'DB error' });
    }
    if (!data) {
        return res.status(404).json({ error: 'Player not found' });
    }

    void logAction({
        action: 'player.aka',
        actorId: (req as any).userId,
        entityType: 'player',
        entityId: id,
        summary: `Изменён aka игрока "${data.name}": ${trimmed || '—'}`,
        details: { playerName: data.name, aka: trimmed || null },
    });

    res.json({ ok: true, player: data });
});

// ============================================================
// PATCH /api/admin/players/:id/name
// Переименовать игрока (только админ)
// ============================================================
adminRouter.patch('/players/:id/name', async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: 'Invalid player id' });
    }

    const name = req.body?.name;
    if (typeof name !== 'string') {
        return res.status(400).json({ error: 'name is required' });
    }

    const trimmed = name.trim();
    if (trimmed.length === 0) {
        return res.status(400).json({ error: 'name cannot be empty' });
    }
    if (trimmed.length > 100) {
        return res.status(400).json({ error: 'name is too long (max 100)' });
    }

    const { data, error } = await supabaseAdmin
        .from('players')
        .update({ name: trimmed })
        .eq('id', id)
        .select()
        .maybeSingle();

    if (error) {
        console.error('[admin/players/name] error:', error);
        if (error.code === '23505') {
            return res.status(409).json({ error: 'Player with this name already exists' });
        }
        return res.status(500).json({ error: 'DB error' });
    }
    if (!data) {
        return res.status(404).json({ error: 'Player not found' });
    }

    void logAction({
        action: 'player.rename',
        actorId: (req as any).userId,
        entityType: 'player',
        entityId: id,
        summary: `Игрок #${id} переименован в "${data.name}"`,
        details: { playerName: data.name },
    });

    res.json({ ok: true, player: data });
});

// ============================================================
// DELETE /api/admin/users/:id
// Удалить пользователя (только админ)
// ============================================================
adminRouter.delete('/users/:id', async (req, res) => {
    const userId = req.params.id;
    if (!userId || typeof userId !== 'string') {
        return res.status(400).json({ error: 'Invalid user id' });
    }

    // Нельзя удалить самого себя
    const selfId = (req as any).userId as string;
    if (userId === selfId) {
        return res.status(400).json({ error: 'Cannot delete your own account' });
    }

    const { data: targetProfile } = await supabaseAdmin
        .from('profiles')
        .select('username')
        .eq('user_id', userId)
        .maybeSingle();

    const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);

    if (error) {
        console.error('[admin/users/delete] error:', error);
        return res.status(500).json({ error: error.message });
    }

    void logAction({
        action: 'user.delete',
        actorId: selfId,
        entityType: 'user',
        summary: `Удалён пользователь ${targetProfile?.username ?? userId}`,
        details: { targetUserId: userId },
    });

    res.json({ ok: true });
});

// ============================================================
// POST /api/admin/players/:id/link-user
// Связать игрока с пользователем (по email или username)
// Body: { userId } или { email } или { username }
// ============================================================
adminRouter.post('/players/:id/link-user', async (req, res) => {
  const playerId = Number(req.params.id);
  if (!Number.isInteger(playerId) || playerId <= 0) {
    return res.status(400).json({ error: 'Invalid player id' });
  }

  const { userId, email, username } = req.body ?? {};

  let targetUserId: string | null = null;

  // 1. Прямо по userId
  if (typeof userId === 'string' && userId) {
    targetUserId = userId;
  } else if (typeof email === 'string' && email) {
    // 2. По email — ищем через auth.admin
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 });
    if (error) return res.status(500).json({ error: 'Auth error' });
    const found = data.users.find(
      (u) => u.email?.toLowerCase() === email.trim().toLowerCase()
    );
    if (!found) return res.status(404).json({ error: 'User not found' });
    targetUserId = found.id;
  } else if (typeof username === 'string' && username) {
    // 3. По username — через profiles
    const { data, error } = await supabaseAdmin
      .from('profiles')
      .select('user_id')
      .ilike('username', username.trim())
      .maybeSingle();
    if (error) return res.status(500).json({ error: 'DB error' });
    if (!data) return res.status(404).json({ error: 'User not found' });
    targetUserId = data.user_id;
  } else {
    return res.status(400).json({ error: 'userId, email, or username required' });
  }

  // Проверяем, что этот userId ещё не привязан к другому игроку
  const { data: existing } = await supabaseAdmin
    .from('players')
    .select('id, name')
    .eq('user_id', targetUserId)
    .maybeSingle();

  if (existing && existing.id !== playerId) {
    return res.status(409).json({
      error: `This user is already linked to player "${existing.name}"`,
    });
  }

  const { data, error } = await supabaseAdmin
    .from('players')
    .update({ user_id: targetUserId })
    .eq('id', playerId)
    .select()
    .maybeSingle();

  if (error) {
    console.error('[admin/link-user] error:', error);
    return res.status(500).json({ error: 'DB error' });
  }
    if (!data) {
        return res.status(404).json({ error: 'Player not found' });
    }

    const { data: linkProfile } = await supabaseAdmin
        .from('profiles')
        .select('username')
        .eq('user_id', targetUserId)
        .maybeSingle();

    void logAction({
        action: 'player.link',
        actorId: (req as any).userId,
        entityType: 'player',
        entityId: playerId,
        summary: `Игрок "${data.name}" привязан к ${linkProfile?.username ?? targetUserId}`,
        details: { targetUserId },
    });

    res.json({ ok: true, player: data });
});

// ============================================================
// POST /api/admin/players/:id/unlink-user
// Отвязать игрока от пользователя
// ============================================================
adminRouter.post('/players/:id/unlink-user', async (req, res) => {
  const playerId = Number(req.params.id);
  if (!Number.isInteger(playerId) || playerId <= 0) {
    return res.status(400).json({ error: 'Invalid player id' });
  }

  const { data: playerRow } = await supabaseAdmin
    .from('players')
    .select('name')
    .eq('id', playerId)
    .maybeSingle();

  const { error } = await supabaseAdmin
    .from('players')
    .update({ user_id: null })
    .eq('id', playerId);

  if (error) {
    console.error('[admin/unlink-user] error:', error);
    return res.status(500).json({ error: 'DB error' });
  }

  void logAction({
    action: 'player.unlink',
    actorId: (req as any).userId,
    entityType: 'player',
    entityId: playerId,
    summary: `Игрок "${playerRow?.name ?? playerId}" отвязан от профиля`,
  });

  res.json({ ok: true });
});