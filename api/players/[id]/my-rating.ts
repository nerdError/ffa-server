import type { VercelRequest, VercelResponse } from '@vercel/node';
import { authenticate } from '../../../lib/auth';
import { jsonError, methodNotAllowed } from '../../../lib/http';

function parseId(raw: string | string[] | undefined): number | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return null;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const playerId = parseId(req.query.id);
  if (playerId === null) return jsonError(res, 400, 'Invalid player id');

  // DELETE /api/players/:id/my-rating — удалить свою оценку
  if (req.method === 'DELETE') {
    const auth = await authenticate(req);
    if (!auth.ok) return jsonError(res, auth.status, auth.error);

    const { data, error } = await auth.client
      .from('ratings')
      .delete()
      .eq('player_id', playerId)
      .eq('user_id', auth.user.id)
      .select()
      .maybeSingle();

    if (error) return jsonError(res, 500, error.message);
    if (!data) return jsonError(res, 404, 'Rating not found');
    return res.status(200).json({ deleted: data });
  }

  // GET /api/players/:id/my-rating — своя оценка (или null)
  if (req.method === 'GET') {
    const auth = await authenticate(req);
    if (!auth.ok) return jsonError(res, auth.status, auth.error);

    const { data, error } = await auth.client.rpc('get_my_rating', {
      p_id: playerId,
    });
    if (error) return jsonError(res, 500, error.message);

    const rating = data && data.length > 0 ? data[0] : null;
    return res.status(200).json({ rating });
  }

  return methodNotAllowed(res, ['GET', 'DELETE']);
}