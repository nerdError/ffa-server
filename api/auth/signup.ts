import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabase } from '../../lib/supabase';
import { jsonError, methodNotAllowed } from '../../lib/http';

const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,32}$/;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  const { email, password, username } = req.body ?? {};

  if (typeof email !== 'string' || typeof password !== 'string') {
    return jsonError(res, 400, 'email and password are required');
  }
  if (typeof username !== 'string') {
    return jsonError(res, 400, 'username is required');
  }
  const trimmedUsername = username.trim();
  if (!USERNAME_RE.test(trimmedUsername)) {
    return jsonError(
      res,
      400,
      'username must be 3-32 chars: letters, digits, _, ., -'
    );
  }
  if (!email.includes('@') || email.length > 254) {
    return jsonError(res, 400, 'Invalid email');
  }
  if (password.length < 6) {
    return jsonError(res, 400, 'Password must be at least 6 characters');
  }

  // Проверим, что username свободен (до регистрации)
  // (триггер в БД тоже проверит по UNIQUE, но здесь можно дать более понятную ошибку)
  const { data: existing } = await supabase
    .from('profiles')
    .select('user_id')
    .ilike('username', trimmedUsername)
    .maybeSingle();

  if (existing) {
    return jsonError(res, 409, 'username is already taken');
  }

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { username: trimmedUsername },
    },
  });

  if (error) {
    // Если триггер упал на UNIQUE (гонка двух регистраций с одним ником)
    if (error.message.toLowerCase().includes('duplicate')) {
      return jsonError(res, 409, 'username is already taken');
    }
    return jsonError(res, 400, error.message);
  }

  return res.status(201).json({
    user: data.user
      ? { id: data.user.id, email: data.user.email, username: trimmedUsername }
      : null,
    session: data.session,
    note: data.session
      ? undefined
      : 'Check your email to confirm your account',
  });
}