import type { VercelRequest, VercelResponse } from '@vercel/node';
import { anonClient, authenticate } from '../../lib/auth';
import { jsonError, methodNotAllowed } from '../../lib/http';

function parseId(raw: string | string[] | undefined): number | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) return null;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const id = parseId(req.query.id);
  if (id === null) return jsonError(res, 400, 'Invalid id');

  // GET /api/players/:id — публичный
  if (req.method === 'GET') {
    const client = anonClient();
    const { data, error } = await client.rpc('get_player_with_stats', {
      p_id: id,
    });
    if (error) return jsonError(res, 500, error.message);
    if (!data || data.length === 0) {
      return jsonError(res, 404, 'Player not found');
    }
    return res.status(200).json({ player: data[0] });
  }

  // DELETE /api/players/:id — только модераторы (RLS всё равно проверит)
  if (req.method === 'DELETE') {
    const auth = await authenticate(req);
    if (!auth.ok) return jsonError(res, auth.status, auth.error);

    const { data, error } = await auth.client
      .from('players')
      .delete()
      .eq('id', id)
      .select()
      .maybeSingle();

    if (error) return jsonError(res, 500, error.message);
    if (!data) {
      // либо игрока нет, либо RLS не пропустил (не модератор)
      return jsonError(res, 404, 'Player not found or not permitted');
    }
    return res.status(200).json({ deleted: data });
  }

  return methodNotAllowed(res, ['GET', 'DELETE']);
}