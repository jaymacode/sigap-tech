import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '@/server/db/migrate';
import { hydrateStore, persistDiff, saveAll, takeSnapshot } from '@/server/db/persistence';
import type { Store } from '@/server/mock/store';
import {
  addComment,
  assignTicket,
  createTicket,
  runSlaTick,
  transitionTicket,
} from '@/server/mock/ticket-engine';
import type { UserRecord } from '@/server/mock/types';
import {
  ensureTestDatabase,
  expectSameStore,
  NOW,
  resetSchema,
  seededStore,
  TEST_DATABASE_URL,
} from './helpers';

const DAY_MS = 86_400_000;

function firstUser(store: Store, role: UserRecord['role']): UserRecord {
  const user = [...store.users.values()].find((u) => u.role === role && u.isActive);
  if (!user) throw new Error(`tidak ada user ${role}`);
  return user;
}

describe.skipIf(!TEST_DATABASE_URL)('persistDiff', () => {
  let pool: Pool;

  beforeAll(async () => {
    await ensureTestDatabase(TEST_DATABASE_URL!);
    pool = new Pool({ connectionString: TEST_DATABASE_URL, max: 4 });
    await resetSchema(pool);
    await runMigrations(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('mutasi engine → persistDiff → hydrate sama dengan store yang termutasi', async () => {
    const store = seededStore(NOW);
    await saveAll(pool, store);
    const before = takeSnapshot(store);

    const requester = firstUser(store, 'requester');
    const agent = firstUser(store, 'agent');
    const later = new Date(NOW.getTime() + 5 * DAY_MS);

    const ticket = createTicket(
      store,
      {
        catalogItemId: 'cat-item-password',
        title: 'Uji persist',
        description: 'Tiket uji persistDiff',
        urgency: 'high',
        formData: {},
      },
      requester,
      NOW,
    );
    assignTicket(store, ticket.id, { assigneeId: agent.id }, agent, NOW);
    transitionTicket(store, ticket.id, 'in_progress', agent, {}, NOW);
    addComment(store, ticket.id, agent, 'Catatan uji', 'public', NOW);
    runSlaTick(store, later);
    const roleChanged = firstUser(store, 'requester');
    roleChanged.role = 'agent';

    const result = await persistDiff(pool, store, before);
    expect(result.counts.tickets.upserted).toBeGreaterThan(0);
    expect(result.counts.ticket_events.upserted).toBeGreaterThan(0);
    expect(result.counts.comments.upserted).toBe(1);
    expect(result.counts.users.upserted).toBe(1);
    expect(result.counts.users.deleted).toBe(0);
    expect(result.counts.ticket_events.deleted).toBe(0);

    const hydrated = await hydrateStore(pool);
    expectSameStore(hydrated, store);

    const again = await persistDiff(pool, store, result.snapshot);
    const written = Object.values(again.counts).reduce((n, c) => n + c.upserted + c.deleted, 0);
    expect(written).toBe(0);
    console.log(
      `[timing] persistDiff ${result.durationMs.toFixed(0)} ms (mutasi), ${again.durationMs.toFixed(0)} ms (tanpa perubahan)`,
    );
  });
});
