import { join } from 'node:path';
import { Hono } from 'hono';
import { serveStatic } from 'hono/bun';
import { apiRoutes } from './routes/api';
import { approvalRoutes } from './routes/approvals';
import { authRoutes, imsRoutes } from './routes/auth';
import pageRoutes from './routes/pages';
import { sweepOrphanUploads } from './server/attachments';
import { assertAuthConfig } from './server/auth/config';
import { initDatabaseStore } from './server/db/bootstrap';
import { processMailOutbox } from './server/mail/worker';
import { getStore, persistStore } from './server/mock/db';
import { runSlaTick } from './server/mock/ticket-engine';

const WORKER_INTERVAL_MS = 60_000;
const PUBLIC_DIR = join(import.meta.dir, '..', 'public');

export function createApp(): Hono {
  const app = new Hono();

  app.get('/app.css', () =>
    new Response(Bun.file(join(PUBLIC_DIR, 'app.css')), {
      headers: { 'Content-Type': 'text/css; charset=utf-8' },
    }),
  );
  app.get('/app.js', () =>
    new Response(Bun.file(join(PUBLIC_DIR, 'app.js')), {
      headers: { 'Content-Type': 'text/javascript; charset=utf-8' },
    }),
  );
  app.use('/*', serveStatic({ root: PUBLIC_DIR }));

  app.route('/api/auth', authRoutes);
  app.route('/auth/ims', imsRoutes);
  app.route('/', approvalRoutes);
  app.route('/api', apiRoutes);
  app.route('/', pageRoutes);

  app.notFound((c) => {
    if (c.req.path === '/api' || c.req.path.startsWith('/api/')) {
      return c.json({ ok: false, error: 'Not found' }, 404);
    }
    return c.html(
      '<!doctype html><html lang="id"><head><meta charset="utf-8"><title>404 — Sigap</title></head><body><h1>404 — Halaman tidak ditemukan</h1><p><a href="/">Kembali ke beranda</a></p></body></html>',
      404,
    );
  });

  return app;
}

if (import.meta.main) {
  assertAuthConfig(); // menolak start bila SESSION_SECRET / AUTH_MODE salah konfigurasi
  await initDatabaseStore();
  const app = createApp();

  const timer = setInterval(() => {
    try {
      runSlaTick(getStore(), new Date());
      sweepOrphanUploads(getStore(), new Date());
      persistStore().catch((err: unknown) => {
        console.error('[worker] gagal menyimpan SLA tick', err);
      });
    } catch (err: unknown) {
      console.error('[worker] gagal menjalankan SLA tick', err);
    }
    processMailOutbox(getStore(), new Date())
      .then((n) => (n ? persistStore() : undefined))
      .catch((err: unknown) => console.error('[worker] gagal memproses outbox email', err));
  }, WORKER_INTERVAL_MS);
  timer.unref?.();

  const port = Number(process.env.PORT ?? 3000);
  const server = Bun.serve({ port, fetch: app.fetch });
  console.log(`Sigap running at http://localhost:${server.port}`);
}
