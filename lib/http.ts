import type { VercelResponse } from '@vercel/node';

export function jsonError(
  res: VercelResponse,
  status: number,
  message: string,
  extra?: Record<string, unknown>
): void {
  res.status(status).json({ error: message, ...extra });
}

export function methodNotAllowed(res: VercelResponse, allowed: string[]): void {
  res.setHeader('Allow', allowed.join(', '));
  res.status(405).json({ error: 'Method Not Allowed' });
}