import { NextResponse } from 'next/server';
import { getPool, isDatabaseEnabled } from '@/server/db/pool';
import { getStore } from '@/server/mock/db';

export const dynamic = 'force-dynamic';

/** Batas waktu pemeriksaan database agar health check tidak menggantung. */
const DB_HEALTH_TIMEOUT_MS = 2000;

interface DatabaseHealth {
  enabled: boolean;
  ok?: boolean;
  latencyMs?: number;
}

/**
 * Memeriksa konektivitas PostgreSQL dengan `SELECT 1`. Hanya aktif bila `DATABASE_URL` diset.
 */
async function checkDatabase(): Promise<DatabaseHealth> {
  if (!isDatabaseEnabled()) return { enabled: false };

  const started = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      getPool().query('SELECT 1'),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('timeout')), DB_HEALTH_TIMEOUT_MS);
      }),
    ]);
    return { enabled: true, ok: true, latencyMs: Date.now() - started };
  } catch {
    return { enabled: true, ok: false, latencyMs: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Health check endpoint untuk Docker HEALTHCHECK dan CI smoke test.
 * Mengembalikan status aplikasi, kesiapan database/store, dan waktu tick worker terakhir.
 * Mengembalikan 503 bila database diaktifkan tetapi tidak dapat dijangkau.
 */
export async function GET() {
  const database = await checkDatabase();
  const databaseDown = database.enabled && database.ok !== true;

  try {
    const store = getStore();
    const version = process.env.APP_VERSION || '0.1.0';
    const lastTick = store.workerLastTick ? store.workerLastTick.toISOString() : null;

    return NextResponse.json(
      {
        status: databaseDown ? 'unhealthy' : 'healthy',
        version,
        db: 'ready',
        database,
        worker_last_tick: lastTick,
        uptime_seconds: Math.floor(process.uptime()),
        timestamp: new Date().toISOString(),
      },
      { status: databaseDown ? 503 : 200 },
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json(
      {
        status: 'unhealthy',
        error: message,
        database,
        timestamp: new Date().toISOString(),
      },
      { status: 503 },
    );
  }
}
