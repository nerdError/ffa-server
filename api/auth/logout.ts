import type { VercelRequest, VercelResponse } from '@vercel/node';
import { authenticate } from '../../lib/auth';
import { jsonError, methodNotAllowed } from '../../lib/http';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  const auth = await authenticate(req);
  if (!auth.ok) return jsonError(res, auth.status, auth.error);

  await auth.client.auth.signOut();
  return res.status(200).json({ ok: true });
}