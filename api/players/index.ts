import type { VercelRequest, VercelResponse } from '@vercel/node';
import { anonClient, authenticate } from '../../lib/auth';
import { jsonError, methodNotAllowed } from '../../lib/http';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // GET /api/players — публичный список со средними
  if (req.method === 'GET') {
    const client = anonClient();
    const { data, error } = await client.rpc('get_players_with_stats');
    if (error) return jsonError(res, 500, error.message);
    return res.status(200).json({ players: data });
  }

  // POST /api/players — только авторизованные
  if (req.method === 'POST') {
    const auth = await authenticate(req);
    if (!auth.ok) return jsonError(res, auth.status, auth.error);

    const name = req.body?.name;
    if (typeof name !== 'string' || name.trim().length === 0) {
      return jsonError(res, 400, 'name is required');
    }
    if (name.trim().length > 100) {
      return jsonError(res, 400, 'name is too long (max 100 chars)');
    }

    const { data, error } = await auth.client
      .from('players')
      .insert({ name: name.trim(), created_by: auth.user.id })
      .select()
      .single();

    if (error) {
      // 23505 — unique violation
      const status = error.code === '23505' ? 409 : 500;
      return jsonError(res, status, error.message);
    }

    return res.status(201).json({ player: data });
  }

  return methodNotAllowed(res, ['GET', 'POST']);
}