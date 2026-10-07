import type { Request, Response, NextFunction } from 'express';

interface Options {
  windowMs: number;
  max: number;
}

/**
 * Простой in-memory rate-limiter по IP (скользящее окно).
 * Подходит для одиночного инстанса (pm2) без общего хранилища.
 */
export function createIpRateLimiter(opts: Options) {
  const hits = new Map<string, number[]>();

  return function ipRateLimit(req: Request, res: Response, next: NextFunction): void {
    const ip = req.ip ?? req.socket?.remoteAddress ?? 'unknown';
    const now = Date.now();
    const windowStart = now - opts.windowMs;

    const list = (hits.get(ip) ?? []).filter((ts) => ts > windowStart);

    if (list.length >= opts.max) {
      res.status(429).json({ error: 'Too many requests. Please try again later.' });
      return;
    }

    list.push(now);
    hits.set(ip, list);

    // Периодическая чистка устаревших записей, чтобы память не росла.
    if (hits.size > 10_000) {
      for (const [key, arr] of hits) {
        if (arr.every((ts) => ts <= windowStart)) hits.delete(key);
      }
    }

    next();
  };
}