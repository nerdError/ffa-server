import { Router } from 'express';
import { authenticate } from '../../lib/auth.js';
import { supabaseAdmin } from '../../lib/supabase-admin.js';

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

  // Сортируем: сначала с ролями, потом по email
  filtered.sort((a, b) => {
    const aHas = a.roles.length > 0 ? 1 : 0;
    const bHas = b.roles.length > 0 ? 1 : 0;
    if (aHas !== bHas) return bHas - aHas;
    return a.email.localeCompare(b.email);
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

  res.json({ ok: true });
});

// ============================================================
// POST /api/admin/roles/revoke
// { userId, role }
// ============================================================
adminRouter.post('/roles/revoke', async (req, res) => {
  const { userId, role } = req.body ?? {};

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