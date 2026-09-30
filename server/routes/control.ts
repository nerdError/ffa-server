import { Router } from 'express';
import { authenticate } from '../../lib/auth.js';
import { supabaseAdmin } from '../../lib/supabase-admin.js';
import { randomBytes } from 'node:crypto';
import {
  getState,
  showPlayer,
  hidePlayer,
  updateSettings,
  type AnimationType,
} from '../overlay-state.js';

export const controlRouter = Router();

const ALLOWED_ANIMATIONS: AnimationType[] = [
  'fade', 'slide-left', 'slide-right', 'slide-up', 'slide-down', 'none',
];

/**
 * Middleware: требует JWT, кладёт user.id в req.userId.
 */
controlRouter.use(async (req, res, next) => {
  const auth = await authenticate(req);
  if (!auth.ok) {
    return res.status(auth.status).json({ error: auth.error });
  }
  (req as any).userId = auth.user.id;
  next();
});

// Хелпер для безопасного получения userId в роутах
function requireUserId(req: any, res: any): string | null {
  const userId = req.userId;
  if (typeof userId !== 'string' || !userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return null;
  }
  return userId;
}

// ============================================================
// GET /api/control/state
// ============================================================
controlRouter.get('/state', (req, res) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  res.json(getState(userId));
});

// ============================================================
// POST /api/control/show
// ============================================================
controlRouter.post('/show', (req, res) => {
  const userId = requireUserId(req, res);
  if (!userId) return;

  const playerId = Number(req.body?.playerId);
  if (!Number.isInteger(playerId) || playerId <= 0) {
    return res.status(400).json({ error: 'Invalid playerId' });
  }
  showPlayer(userId, playerId);
  res.json({ ok: true, state: getState(userId) });
});

// ============================================================
// POST /api/control/hide
// ============================================================
controlRouter.post('/hide', (req, res) => {
  const userId = requireUserId(req, res);
  if (!userId) return;
  hidePlayer(userId);
  res.json({ ok: true, state: getState(userId) });
});

// ============================================================
// POST /api/control/settings
// ============================================================
controlRouter.post('/settings', (req, res) => {
  const userId = requireUserId(req, res);
  if (!userId) return;

  const { animation, autoHide, autoHideDelay } = req.body ?? {};
  const patch: Record<string, unknown> = {};

  if (animation !== undefined) {
    if (!ALLOWED_ANIMATIONS.includes(animation)) {
      return res.status(400).json({ error: 'Invalid animation' });
    }
    patch.animation = animation;
  }
  if (autoHide !== undefined) {
    if (typeof autoHide !== 'boolean') {
      return res.status(400).json({ error: 'autoHide must be boolean' });
    }
    patch.autoHide = autoHide;
  }
  if (autoHideDelay !== undefined) {
    const d = Number(autoHideDelay);
    if (!Number.isInteger(d) || d < 1 || d > 600) {
      return res.status(400).json({ error: 'autoHideDelay must be 1-600' });
    }
    patch.autoHideDelay = d;
  }

  updateSettings(userId, patch);
  res.json({ ok: true, state: getState(userId) });
});

// ============================================================
// GET /api/control/token — получить или создать токен оверлея
// ============================================================
controlRouter.get('/token', async (req, res) => {
  const userId = requireUserId(req, res);
  if (!userId) return;

  // Ищем существующий токен
  const { data: existing, error: selectErr } = await supabaseAdmin
    .from('overlay_tokens')
    .select('token')
    .eq('user_id', userId)
    .maybeSingle();

  if (selectErr) {
    console.error('[control/token] select failed:', selectErr);
    return res.status(500).json({ error: 'DB error' });
  }

  if (existing?.token) {
    return res.json({ token: existing.token });
  }

  // Создаём новый
  const token = randomBytes(24).toString('hex');
  const { error: insertErr } = await supabaseAdmin
    .from('overlay_tokens')
    .insert({ user_id: userId, token });

  if (insertErr) {
    console.error('[control/token] insert failed:', insertErr);
    return res.status(500).json({ error: 'Failed to create token' });
  }

  return res.json({ token });
});

// ============================================================
// POST /api/control/token/regenerate — перевыпустить токен
// ============================================================
controlRouter.post('/token/regenerate', async (req, res) => {
  const userId = requireUserId(req, res);
  if (!userId) return;

  const token = randomBytes(24).toString('hex');

  const { error } = await supabaseAdmin
    .from('overlay_tokens')
    .upsert(
      { user_id: userId, token },
      { onConflict: 'user_id' }
    );

  if (error) {
    console.error('[control/token/regenerate] failed:', error);
    return res.status(500).json({ error: 'Failed to regenerate token' });
  }

  return res.json({ token });
});