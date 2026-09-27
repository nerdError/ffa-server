import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabase } from '../../lib/supabase';
import { jsonError, methodNotAllowed } from '../../lib/http';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,32}$/;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  const { identifier, password } = req.body ?? {};

  if (typeof identifier !== 'string' || typeof password !== 'string') {
    return jsonError(res, 400, 'identifier and password are required');
  }

  const trimmed = identifier.trim();
  if (!trimmed || !password) {
    return jsonError(res, 400, 'identifier and password are required');
  }

  let email: string | null = null;

  if (EMAIL_RE.test(trimmed)) {
    // Похоже на email
    email = trimmed.toLowerCase();
  } else if (USERNAME_RE.test(trimmed)) {
    // Похоже на username — ищем email через RPC
    const { data, error } = await supabase.rpc('get_email_by_username', {
      p_username: trimmed,
    });

    if (error) {
      console.error('[login] get_email_by_username failed:', error);
      return jsonError(res, 500, 'Internal error');
    }

    email = typeof data === 'string' ? data : null;
  } else {
    return jsonError(res, 400, 'identifier is not a valid email or username');
  }

  // Единый ответ на «не найден» и «неверный пароль» — не раскрываем существование аккаунта
  if (!email) {
    return jsonError(res, 401, 'Invalid credentials');
  }

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    // Supabase вернёт "Invalid login credentials" — не различаем случаи
    return jsonError(res, 401, 'Invalid credentials');
  }

  return res.status(200).json({
    user: { id: data.user.id, email: data.user.email },
    access_token: data.session?.access_token,
    refresh_token: data.session?.refresh_token,
    expires_at: data.session?.expires_at,
  });
}