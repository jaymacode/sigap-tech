import { NextResponse } from 'next/server';
import { getStore } from '@/server/mock/db';

export const dynamic = 'force-dynamic';

/**
 * Health check endpoint untuk Docker HEALTHCHECK dan CI smoke test.
 * Mengembalikan status aplikasi, kesiapan database/store, dan waktu tick worker terakhir.
 */
export async function GET() {
  try {
    const store = getStore();
    const version = process.env.APP_VERSION || '0.1.0';
    const lastTick = store.workerLastTick ? store.workerLastTick.toISOString() : null;

    return NextResponse.json(
      {
        status: 'healthy',
        version,
        db: 'ready',
        worker_last_tick: lastTick,
        uptime_seconds: Math.floor(process.uptime()),
        timestamp: new Date().toISOString(),
      },
      { status: 200 },
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json(
      {
        status: 'unhealthy',
        error: message,
        timestamp: new Date().toISOString(),
      },
      { status: 503 },
    );
  }
}
