import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { authRouter } from './routes/auth';
import { playersRouter } from './routes/players';
import { ratingsRouter } from './routes/ratings';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { controlRouter } from './routes/control.js';
import { overlayRouter } from './routes/overlay.js';
import { supabaseAdmin } from '../lib/supabase-admin';
import { authenticate } from '../lib/auth';
import { adminRouter } from './routes/admin';

const execFileAsync = promisify(execFile);

// __dirname для ES-модулей
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// ============================================================
// GitHub Webhook — ДО express.json(), потому что нужен raw body
// ============================================================
app.post(
  '/api/deploy',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    const signature = req.headers['x-hub-signature-256'] as string | undefined;
    const event = req.headers['x-github-event'] as string | undefined;
    const secret = process.env.GITHUB_WEBHOOK_SECRET;

    // 1. Проверяем наличие секрета и подписи
    if (!secret) {
      console.error('[deploy] GITHUB_WEBHOOK_SECRET is not set');
      return res.status(500).json({ error: 'Server configuration error' });
    }
    if (!signature) {
      console.error('[deploy] Missing signature');
      return res.status(401).json({ error: 'Missing signature' });
    }

    // 2. Вычисляем HMAC-SHA256 от СЫРОГО тела
    const hmac = createHmac('sha256', secret);
    hmac.update(req.body); // req.body здесь — Buffer, спасибо express.raw()
    const digest = 'sha256=' + hmac.digest('hex');

    // 3. Безопасное сравнение (защита от timing-атак)
    const trusted = Buffer.from(digest, 'ascii');
    const untrusted = Buffer.from(signature, 'ascii');

    if (
      trusted.length !== untrusted.length ||
      !timingSafeEqual(trusted, untrusted)
    ) {
      console.error('[deploy] Invalid signature');
      return res.status(401).json({ error: 'Invalid signature' });
    }

    // 4. Проверяем, что это push и что ветка — main
    if (event !== 'push') {
      return res.status(200).json({ received: true, ignored: true });
    }

    const payload = JSON.parse(req.body.toString());
    const ref = payload.ref as string | undefined;

    if (ref !== 'refs/heads/main') {
      return res.status(200).json({ received: true, ignored: true });
    }

    // 5. Отвечаем GitHub СРАЗУ, чтобы не было таймаута
    res.status(200).json({ received: true, deploying: true });

    // 6. Запускаем деплой в фоне
    try {
      const { stdout, stderr } = await execFileAsync(
        '/home/admin/web/sc2-ffa-league.ru/nodeapp/deploy.sh',
        [],
        { timeout: 120_000 } // 2 минуты
      );
    //   console.log('[deploy] stdout:', stdout);
      if (stderr) console.error('[deploy] stderr:', stderr);
      console.log('[deploy] Deployment finished successfully');
    } catch (err) {
      console.error('[deploy] Deployment failed:', err);
    }
  }
);

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
app.use('/api/control', controlRouter);
app.use('/api/overlay', overlayRouter);
app.use('/api/admin', adminRouter);

// Health-check
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

// app.get('/api/debug/admin-check', async (_req, res) => {
//   try {
//     const { data, error } = await supabaseAdmin
//       .from('overlay_tokens')
//       .select('user_id, token')
//       .limit(1);

//     if (error) {
//       return res.status(500).json({ ok: false, error: error.message });
//     }

//     res.json({ ok: true, count: data?.length ?? 0 });
//   } catch (err) {
//     res.status(500).json({
//       ok: false,
//       error: err instanceof Error ? err.message : String(err),
//     });
//   }
// });

// app.get('/api/debug/whoami', async (req, res) => {
//   const auth = await authenticate(req);
//   if (!auth.ok) return res.status(auth.status).json({ error: auth.error });
//   res.json({ id: auth.user.id, email: auth.user.email });
// });

// ============================================================
// Статика: раздаём собранный фронтенд из dist/
// ============================================================
const distDir = path.resolve(__dirname, '..', 'dist');

// Явные страницы (до express.static и до SPA-фолбэка!)
app.get('/overlay', (_req, res) => {
  res.sendFile(path.join(distDir, 'overlay.html'));
});

app.get('/control', (_req, res) => {
  res.sendFile(path.join(distDir, 'control.html'));
});

app.get('/admin', (_req, res) => {
  res.sendFile(path.join(distDir, 'admin.html'));
});

// Общая статика (assets, favicon и т.д.)
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
  console.log("hello there 5345454");
});
