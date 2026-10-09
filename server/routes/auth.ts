import { Router } from 'express';
import { supabase } from '../../lib/supabase.js';
import { authenticate, isUserBanned } from '../../lib/auth.js';
import { logAction } from '../../lib/action-log.js';
import { createIpRateLimiter } from '../../lib/rate-limit.js';

export const authRouter = Router();

const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,32}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Rate-limit регистрации по IP: максимум 3 аккаунта за 10 минут.
const signupLimiter = createIpRateLimiter({
  windowMs: 10 * 60 * 1000,
  max: 3,
});

/**
 * Проверяет Turnstile-токен, если CAPTCHA включена (есть секрет).
 * Возвращает { ok: true } если капча не требуется или прошла успешно.
 */
async function verifyCaptcha(token: string | undefined): Promise<{ ok: boolean; error?: string }> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return { ok: true }; // CAPTCHA не настроена — пропускаем.

  if (!token || typeof token !== 'string') {
    return { ok: false, error: 'captcha is required' };
  }

  try {
    const resp = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret, response: token }),
    });
    const body = (await resp.json()) as { success?: boolean; 'error-codes'?: string[] };
    if (!body.success) {
      console.warn('[captcha] verify failed:', body['error-codes']);
      return { ok: false, error: 'captcha verification failed' };
    }
    return { ok: true };
  } catch (err) {
    console.error('[captcha] verify error:', err);
    return { ok: false, error: 'captcha verification error' };
  }
}

// GET /api/auth/captcha-config — параметры CAPTCHA для фронта.
authRouter.get('/captcha-config', (_req, res) => {
  const siteKey = process.env.TURNSTILE_SITE_KEY;
  const enabled = Boolean(siteKey && process.env.TURNSTILE_SECRET_KEY);
  res.json({ enabled, siteKey: enabled ? siteKey : null });
});

// POST /api/auth/signup
authRouter.post('/signup', signupLimiter, async (req, res) => {
  const { email, password, username, captchaToken } = req.body ?? {};

  if (typeof email !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'email and password are required' });
  }
  if (typeof username !== 'string') {
    return res.status(400).json({ error: 'username is required' });
  }
  const trimmedUsername = username.trim();
  if (!USERNAME_RE.test(trimmedUsername)) {
    return res
      .status(400)
      .json({ error: 'username must be 3-32 chars: letters, digits, _, ., -' });
  }
  if (!EMAIL_RE.test(email) || email.length > 254) {
    return res.status(400).json({ error: 'Invalid email' });
  }
  if (password.length < 6) {
    return res
      .status(400)
      .json({ error: 'Password must be at least 6 characters' });
  }

  // Проверка занятости username
  const { data: existing } = await supabase
    .from('profiles')
    .select('user_id')
    .ilike('username', trimmedUsername)
    .maybeSingle();

  if (existing) {
    return res.status(409).json({ error: 'username is already taken' });
  }

  // CAPTCHA (если включена). Проверяем в самом конце, чтобы не сжигать
  // одноразовый Turnstile-токен на предотвратимых ошибках валидации выше.
  const captcha = await verifyCaptcha(captchaToken);
  if (!captcha.ok) {
    return res.status(400).json({ error: captcha.error });
  }

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { username: trimmedUsername } },
  });

  if (error) {
    if (error.message.toLowerCase().includes('duplicate')) {
      return res.status(409).json({ error: 'username is already taken' });
    }
    return res.status(400).json({ error: error.message });
  }

  void logAction({
    action: 'auth.signup',
    actorId: data.user?.id ?? null,
    actorUsername: trimmedUsername,
    entityType: 'user',
    summary: `Регистрация: ${trimmedUsername} (${email})`,
    details: { username: trimmedUsername, email },
  });

  return res.status(201).json({
    user: data.user
      ? { id: data.user.id, email: data.user.email, username: trimmedUsername }
      : null,
    session: data.session,
    note: data.session ? undefined : 'Check your email to confirm your account',
  });
});

// POST /api/auth/login
authRouter.post('/login', async (req, res) => {
  const { identifier, password } = req.body ?? {};

  if (typeof identifier !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'identifier and password are required' });
  }

  const trimmed = identifier.trim();
  if (!trimmed || !password) {
    return res.status(400).json({ error: 'identifier and password are required' });
  }

  let email: string | null = null;

  if (EMAIL_RE.test(trimmed)) {
    email = trimmed.toLowerCase();
  } else if (USERNAME_RE.test(trimmed)) {
    const { data, error } = await supabase.rpc('get_email_by_username', {
      p_username: trimmed,
    });
    if (error) {
      console.error('[login] get_email_by_username failed:', error);
      return res.status(500).json({ error: 'Internal error' });
    }
    email = typeof data === 'string' ? data : null;
  } else {
    return res
      .status(400)
      .json({ error: 'identifier is not a valid email or username' });
  }

  if (!email) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  if (await isUserBanned(data.user.id)) {
    return res.status(403).json({ error: 'Account is banned' });
  }

  void logAction({
    action: 'auth.login',
    actorId: data.user.id,
    entityType: 'user',
    summary: `Вход: ${trimmed}`,
    details: { identifier: trimmed },
  });

  return res.status(200).json({
    user: { id: data.user.id, email: data.user.email },
    access_token: data.session?.access_token,
    refresh_token: data.session?.refresh_token,
    expires_at: data.session?.expires_at,
  });
});

// POST /api/auth/logout
authRouter.post('/logout', async (req, res) => {
  const auth = await authenticate(req);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  await auth.client.auth.signOut();

  void logAction({
    action: 'auth.logout',
    actorId: auth.user.id,
    entityType: 'user',
    summary: `Выход: ${auth.user.email ?? auth.user.id}`,
  });

  return res.status(200).json({ ok: true });
});

// GET /api/auth/me
authRouter.get('/me', async (req, res) => {
  const auth = await authenticate(req);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  // Все проверки независимы — выполняем параллельно, чтобы не плодить
  // последовательные походы в БД и не держать соединения дольше нужного.
  const [profileRes, linkedRes, modRes, adminRes, ghostRes] = await Promise.all([
    auth.client
      .from('profiles')
      .select('username, can_rate')
      .eq('user_id', auth.user.id)
      .maybeSingle(),
    auth.client
      .from('players')
      .select('id, name')
      .eq('user_id', auth.user.id)
      .maybeSingle(),
    auth.client.rpc('is_moderator'),
    auth.client.rpc('is_admin'),
    auth.client.rpc('is_ghost'),
  ]);

  const profile = profileRes.data;
  const linkedPlayer = linkedRes.data;

  return res.status(200).json({
    user: {
      id: auth.user.id,
      email: auth.user.email,
      username: profile?.username ?? null,
      is_moderator: Boolean(modRes.data),
      is_admin: Boolean(adminRes.data),
      is_ghost: Boolean(ghostRes.data),
      can_rate: profile?.can_rate !== false,
      player_id: linkedPlayer?.id ?? null,
      player_name: linkedPlayer?.name ?? null,
    },
  });
});

authRouter.post('/refresh', async (req, res) => {
  const { refresh_token } = req.body ?? {};

  if (typeof refresh_token !== 'string' || !refresh_token) {
    return res.status(400).json({ error: 'refresh_token is required' });
  }

  const { data, error } = await supabase.auth.refreshSession({
    refresh_token,
  });

  if (error || !data.session) {
    return res.status(401).json({ error: 'Invalid refresh token' });
  }

  if (data.user && (await isUserBanned(data.user.id))) {
    return res.status(403).json({ error: 'Account is banned' });
  }

  return res.json({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
    expires_at: data.session.expires_at,
    user: data.user
      ? { id: data.user.id, email: data.user.email }
      : null,
  });
});