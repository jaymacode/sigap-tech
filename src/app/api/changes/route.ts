import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getStore } from '@/server/mock/db';
import { nextChangeNumber, nextId } from '@/server/mock/store';
import type { ChangeRecord } from '@/server/mock/types';

export const dynamic = 'force-dynamic';

const createChangeSchema = z.object({
  type: z.enum(['standard', 'normal', 'emergency']).default('standard'),
  title: z.string().min(3),
  source: z.enum(['pipeline', 'manual']).default('pipeline'),
  commitSha: z.string().default('unknown'),
  environment: z.string().default('production-local'),
  fromVersion: z.string().default('0.0.0'),
  toVersion: z.string().default('0.1.0'),
});

function verifyWebhookToken(req: NextRequest): boolean {
  const auth = req.headers.get('authorization');
  const expectedToken = process.env.CHANGE_WEBHOOK_TOKEN || 'local-change-token';
  if (!auth) return false;
  const token = auth.replace(/^Bearer\s+/i, '');
  return token === expectedToken;
}

export async function GET() {
  const store = getStore();
  return NextResponse.json({
    ok: true,
    data: store.changes,
  });
}

export async function POST(req: NextRequest) {
  if (!verifyWebhookToken(req)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const json = await req.json();
    const parsed = createChangeSchema.parse(json);
    const store = getStore();

    const change: ChangeRecord = {
      id: nextId(store, 'chg'),
      number: nextChangeNumber(store),
      type: parsed.type,
      title: parsed.title,
      status: 'in_progress',
      source: parsed.source,
      commitSha: parsed.commitSha,
      environment: parsed.environment,
      startedAt: new Date(),
      finishedAt: null,
      metadata: {
        fromVersion: parsed.fromVersion,
        toVersion: parsed.toVersion,
      },
    };

    store.changes.unshift(change);

    return NextResponse.json({ ok: true, data: change }, { status: 201 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Invalid request';
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }
}
