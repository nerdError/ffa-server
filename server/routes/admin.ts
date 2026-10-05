import { Router } from 'express';
import { authenticate } from '../../lib/auth.js';
import { supabaseAdmin } from '../../lib/supabase-admin.js';
import { logAction } from '../../lib/action-log.js';

export const adminRouter = Router();

const ALLOWED_ROLES = ['moderator', 'admin'] as const;
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
        .select('user_id, username, created_at');

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

    // Собираем карту ролей
    const rolesByUser = new Map<string, { role: Role; granted_at: string }[]>();
    for (const r of roles ?? []) {
        const list = rolesByUser.get(r.user_id) ?? [];
        list.push({ role: r.role as Role, granted_at: r.granted_at });
        rolesByUser.set(r.user_id, list);
    }

    // Собираем карту профилей
    const profileByUser = new Map<string, { username: string | null; created_at: string }>();
    for (const p of users ?? []) {
        profileByUser.set(p.user_id, {
            username: p.username,
            created_at: p.created_at,
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
            roles: (rolesByUser.get(u.id) ?? []).map((r) => r.role),
        };
    });

    // Фильтруем по поиску
    const filtered = q
        ? result.filter((u) => {
            const hay = `${u.email} ${u.username ?? ''}`.toLowerCase();
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
// DELETE /api/admin/ratings/:id
// Удалить любую оценку по ID
// ============================================================
adminRouter.delete('/ratings/:id', async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: 'Invalid rating id' });
    }

    const { data, error } = await supabaseAdmin
        .from('ratings')
        .delete()
        .eq('id', id)
        .select()
        .maybeSingle();

    if (error) {
        console.error('[admin/ratings/delete] error:', error);
        return res.status(500).json({ error: 'DB error' });
    }
    if (!data) {
        return res.status(404).json({ error: 'Rating not found' });
    }

    void logAction({
        action: 'rating.delete',
        actorId: (req as any).userId,
        entityType: 'rating',
        entityId: id,
        summary: `Удалена оценка #${id} (игрок #${data.player_id})`,
        details: { playerId: data.player_id, targetUserId: data.user_id },
    });

    res.json({ ok: true, deleted: data });
});

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