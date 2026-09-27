import type { VercelRequest, VercelResponse } from '@vercel/node';
import { supabase } from '../../lib/supabase';
import { jsonError, methodNotAllowed } from '../../lib/http';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  const { email, password } = req.body ?? {};

  if (typeof email !== 'string' || typeof password !== 'string') {
    return jsonError(res, 400, 'email and password are required');
  }
  if (!email.includes('@') || email.length > 254) {
    return jsonError(res, 400, 'Invalid email');
  }
  if (password.length < 6) {
    return jsonError(res, 400, 'Password must be at least 6 characters');
  }

  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) {
    return jsonError(res, 400, error.message);
  }

  return res.status(201).json({
    user: data.user ? { id: data.user.id, email: data.user.email } : null,
    session: data.session,
    note: data.session
      ? undefined
      : 'Check your email to confirm your account',
  });
}