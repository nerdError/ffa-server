import type { VercelRequest, VercelResponse } from '@vercel/node';
import { authenticate } from '../../lib/auth';
import { jsonError, methodNotAllowed } from '../../lib/http';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);

  const auth = await authenticate(req);
  if (!auth.ok) return jsonError(res, auth.status, auth.error);

  // Узнаём никнейм и признак модератора
  const { data: profile } = await auth.client
    .from('profiles')
    .select('username')
    .eq('user_id', auth.user.id)
    .maybeSingle();

  // Проверка модератора через RPC
  const { data: modData } = await auth.client.rpc('is_moderator');

  return res.status(200).json({
    user: {
      id: auth.user.id,
      email: auth.user.email,
      username: profile?.username ?? null,
      is_moderator: Boolean(modData),
    },
  });
}