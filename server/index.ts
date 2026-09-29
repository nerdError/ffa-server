import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { authRouter } from './routes/auth';
import { playersRouter } from './routes/players';
import { ratingsRouter } from './routes/ratings';

// __dirname для ES-модулей
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// ============================================================
// Глобальные middleware
// ============================================================
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// ============================================================
// API-роуты
// ============================================================
app.use('/api/auth', authRouter);
app.use('/api/players', playersRouter);
app.use('/api/players', ratingsRouter); // ratings вложены в players

// Health-check
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

// ============================================================
// Статика: раздаём собранный фронтенд из dist/
// ============================================================
const distDir = path.resolve(__dirname, '..', 'dist');



app.use(express.static(distDir));

// SPA-фолбэк: любые GET, не начинающиеся с /api, отдают index.html
app.get(/^\/(?!api).*/, (_req, res) => {
  res.sendFile(path.join(distDir, 'index.html'));
});

// ============================================================
// Глобальный обработчик ошибок
// ============================================================
app.use(
  (
    err: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    console.error('[server] unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
);

// ============================================================
// Запуск
// ============================================================
const PORT = Number(process.env.PORT ?? 3000);

app.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`);
});