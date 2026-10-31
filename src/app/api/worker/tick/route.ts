import { NextResponse } from 'next/server';
import { getStore } from '@/server/mock/db';
import { runSlaTick } from '@/server/mock/ticket-engine';

export const dynamic = 'force-dynamic';

/**
 * Endpoint internal untuk memicu proses worker periodik (SLA tick & auto-close).
 */
export async function POST() {
  try {
    const store = getStore();
    const result = runSlaTick(store, new Date());
    return NextResponse.json({
      ok: true,
      data: {
        ...result,
        lastTick: store.workerLastTick?.toISOString(),
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Worker tick failed';
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
