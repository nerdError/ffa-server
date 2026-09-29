import { Router } from 'express';
import {
  getState,
  showPlayer,
  hidePlayer,
  updateSettings,
  type AnimationType,
} from '../overlay-state.js';

export const controlRouter = Router();

const ALLOWED_ANIMATIONS: AnimationType[] = [
  'fade',
  'slide-left',
  'slide-right',
  'slide-up',
  'slide-down',
  'none',
];

// GET /api/control/state — текущее состояние
controlRouter.get('/state', (_req, res) => {
  res.json(getState());
});

// POST /api/control/show — показать карточку игрока
controlRouter.post('/show', (req, res) => {
  const playerId = Number(req.body?.playerId);
  if (!Number.isInteger(playerId) || playerId <= 0) {
    return res.status(400).json({ error: 'Invalid playerId' });
  }
  showPlayer(playerId);
  res.json({ ok: true, state: getState() });
});

// POST /api/control/hide — скрыть карточку
controlRouter.post('/hide', (_req, res) => {
  hidePlayer();
  res.json({ ok: true, state: getState() });
});

// POST /api/control/settings — обновить настройки
controlRouter.post('/settings', (req, res) => {
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
    const delay = Number(autoHideDelay);
    if (!Number.isInteger(delay) || delay < 1 || delay > 600) {
      return res.status(400).json({ error: 'autoHideDelay must be 1-600' });
    }
    patch.autoHideDelay = delay;
  }

  updateSettings(patch);
  res.json({ ok: true, state: getState() });
});
