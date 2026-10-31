import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getStore } from '@/server/mock/db';
import type { ChangeStatus } from '@/server/mock/types';

export const dynamic = 'force-dynamic';

const updateChangeSchema = z.object({
  status: z.enum(['planned', 'in_progress', 'succeeded', 'failed', 'rolled_back']),
  notes: z.string().optional(),
});

function verifyWebhookToken(req: NextRequest): boolean {
  const auth = req.headers.get('authorization');
  const expectedToken = process.env.CHANGE_WEBHOOK_TOKEN || 'local-change-token';
  if (!auth) return false;
  const token = auth.replace(/^Bearer\s+/i, '');
  return token === expectedToken;
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!verifyWebhookToken(req)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { id } = await params;
    const json = await req.json();
    const parsed = updateChangeSchema.parse(json);
    const store = getStore();

    const change = store.changes.find((c) => c.id === id || c.number === id);
    if (!change) {
      return NextResponse.json({ ok: false, error: 'Change record not found' }, { status: 404 });
    }

    change.status = parsed.status as ChangeStatus;
    if (['succeeded', 'failed', 'rolled_back'].includes(parsed.status)) {
      change.finishedAt = new Date();
    }

    return NextResponse.json({ ok: true, data: change });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Invalid request';
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }
}
