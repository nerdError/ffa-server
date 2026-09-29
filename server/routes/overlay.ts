import { Router } from 'express';
import { getState, addSubscriber } from '../overlay-state.js';

export const overlayRouter = Router();

// GET /api/overlay/state — текущее состояние (для первичной загрузки)
overlayRouter.get('/state', (_req, res) => {
  res.json(getState());
});

// GET /api/overlay/stream — SSE-поток обновлений
overlayRouter.get('/stream', (req, res) => {
  // Обязательные заголовки для SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // важно для Nginx — отключает буферизацию

  // Отключаем таймауты (важно для долгоживущего соединения)
  req.socket.setTimeout(0);
  req.socket.setNoDelay(true);
  req.socket.setKeepAlive(true);

  // Отправляем текущее состояние сразу при подключении
  res.write(`data: ${JSON.stringify(getState())}\n\n`);

  // Регистрируем подписчика
  addSubscriber(res);

  // Heartbeat каждые 25 секунд, чтобы прокси не закрыли соединение
  const heartbeat = setInterval(() => {
    try {
      res.write(': heartbeat\n\n');
    } catch {
      clearInterval(heartbeat);
    }
  }, 25_000);

  res.on('close', () => {
    clearInterval(heartbeat);
  });
});