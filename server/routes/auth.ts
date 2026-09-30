import { Router } from 'express';
import { supabase } from '../../lib/supabase.js';
import { authenticate } from '../../lib/auth.js';

export const authRouter = Router();

const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,32}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// POST /api/auth/signup
authRouter.post('/signup', async (req, res) => {
  const { email, password, username } = req.body ?? {};

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
  return res.status(200).json({ ok: true });
});

// GET /api/auth/me
authRouter.get('/me', async (req, res) => {
  const auth = await authenticate(req);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  const { data: profile } = await auth.client
    .from('profiles')
    .select('username')
    .eq('user_id', auth.user.id)
    .maybeSingle();

  // Получаем роли
  const { data: isMod } = await auth.client.rpc('is_moderator');
  const { data: isAdmin } = await auth.client.rpc('is_admin');

  return res.status(200).json({
    user: {
      id: auth.user.id,
      email: auth.user.email,
      username: profile?.username ?? null,
      is_moderator: Boolean(isMod),
      is_admin: Boolean(isAdmin),
    },
  });
});