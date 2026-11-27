import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { SQL } from 'bun';
import { bootstrapPostgres, initDatabaseStore } from '@/server/db/bootstrap';
import { takeSnapshot, type Snapshot } from '@/server/db/persistence';
import { closePg, hydrateStorePg, persistDiffPg } from '@/server/db/postgres';
import { TABLE_NAMES } from '@/server/db/tables';
import { getStore, persistStore, resetStoreAsync } from '@/server/mock/db';
import { addComment, createTicket } from '@/server/mock/ticket-engine';

/**
 * Integration tests against a real PostgreSQL. Skipped unless TEST_DATABASE_URL is set.
 * WARNING: the target database is wiped (all Sigap tables dropped) — use a disposable DB, e.g.
 *   docker compose -f docker-compose.postgres.yml up -d
 *   TEST_DATABASE_URL=postgres://sigap:sigap@localhost:5432/sigap bun test tests/postgres.test.ts
 */
const url = process.env.TEST_DATABASE_URL;

function entries(s: Snapshot): Record<string, Array<[string, string]>> {
  const out: Record<string, Array<[string, string]>> = {};
  for (const name of TABLE_NAMES) out[name] = [...s[name].entries()].sort();
  return out;
}

async function wipe(pg: SQL): Promise<void> {
  await pg.unsafe(
    `DROP TABLE IF EXISTS ${[...TABLE_NAMES, 'schema_migrations'].join(', ')} CASCADE;
     DROP FUNCTION IF EXISTS ticket_events_append_only() CASCADE;`,
  );
}

describe.skipIf(!url)('PostgreSQL persistence', () => {
  let pg: SQL;

  beforeAll(async () => {
    pg = new SQL(url!);
    await wipe(pg);
  });

  afterAll(async () => {
    await pg?.close();
  });

  it('migrates, seeds, then hydrates an identical store', async () => {
    const first = await bootstrapPostgres(pg);
    expect(first.summary.migrationsApplied).toContain('0001_init.sql');
    expect(first.summary.migrationsApplied.length).toBeGreaterThanOrEqual(1);
    expect(first.summary.mode).toBe('seeded');

    const second = await bootstrapPostgres(pg);
    expect(second.summary.migrationsApplied).toEqual([]);
    expect(second.summary.mode).toBe('hydrated');
    expect(entries(second.snapshot)).toEqual(entries(first.snapshot));

    const h = second.store;
    const t = h.tickets.values().next().value!;
    expect(t.createdAt).toBeInstanceOf(Date);
    expect(typeof t.isMajor).toBe('boolean');
    expect(typeof t.formData).toBe('object');
    expect(h.seededAt.toISOString()).toBe(first.store.seededAt.toISOString());
    expect(typeof h.holidays[0]!.date).toBe('string');
    expect([...h.tickets.keys()]).toEqual([...first.store.tickets.keys()]);
  });

  it('persists a diff and round-trips it', async () => {
    const { store, snapshot } = await bootstrapPostgres(pg);
    const requester = [...store.users.values()].find((u) => u.role === 'requester')!;
    const item = [...store.catalog.values()].find((c) => c.isActive)!;
    const now = new Date(store.seededAt.getTime() + 60_000);
    const removed = store.notifications.pop()!;
    const created = createTicket(
      store,
      { catalogItemId: item.id, title: 'PG ticket', description: 'x', urgency: 'high', formData: { os: 'Win' } },
      requester,
      now,
    );
    addComment(store, created.id, requester, 'halo', 'public', now);

    const res = await persistDiffPg(pg, store, snapshot);
    expect(res.counts.tickets.upserted).toBe(1);
    expect(res.counts.comments.upserted).toBe(1);
    expect(res.counts.notifications.deleted).toBe(1);

    const fresh = await hydrateStorePg(pg);
    expect(entries(takeSnapshot(fresh))).toEqual(entries(res.snapshot));
    expect(fresh.tickets.get(created.id)?.formData).toEqual({ os: 'Win' });
    expect(fresh.notifications.some((n) => n.id === removed.id)).toBe(false);

    // A failing write rolls back the whole transaction.
    (fresh.tickets.get(created.id) as { priority: string }).priority = 'P99';
    fresh.tickets.get(created.id)!.title = 'should not stick';
    await expect(persistDiffPg(pg, fresh, res.snapshot)).rejects.toThrow();
    const again = await hydrateStorePg(pg);
    expect(again.tickets.get(created.id)?.title).toBe('PG ticket');
  });

  it('blocks UPDATE, DELETE and TRUNCATE on ticket_events', async () => {
    const rows = (await pg.unsafe('SELECT id FROM ticket_events LIMIT 1')) as Array<{ id: string }>;
    const id = rows[0]!.id;
    await expect(pg.unsafe("UPDATE ticket_events SET type = 'x' WHERE id = $1", [id])).rejects.toThrow(
      /append-only/,
    );
    await expect(pg.unsafe('DELETE FROM ticket_events WHERE id = $1', [id])).rejects.toThrow(/append-only/);
    await expect(pg.unsafe('TRUNCATE ticket_events CASCADE')).rejects.toThrow(/append-only/);
  });

  it('works through the DB_DRIVER=postgres seam (init, persistStore, reset)', async () => {
    const saved = { driver: process.env.DB_DRIVER, dbUrl: process.env.DATABASE_URL };
    process.env.DB_DRIVER = 'postgres';
    process.env.DATABASE_URL = url;
    const g = globalThis as typeof globalThis & Record<string, unknown>;
    for (const k of ['__sigapStore', '__sigapSnapshot', '__sigapChain', '__sigapBootstrap']) g[k] = undefined;
    try {
      const summary = await initDatabaseStore();
      expect(summary.mode).toBe('hydrated');
      const store = getStore();
      store.teams.values().next().value!.description = 'via seam';
      await persistStore();
      const fresh = await hydrateStorePg(pg);
      expect(fresh.teams.values().next().value!.description).toBe('via seam');

      const reset = await resetStoreAsync(new Date('2026-11-26T00:00:00Z'));
      expect(reset.teams.values().next().value!.description).not.toBe('via seam');
      const id = [...reset.events.values()].flat()[0]!.id;
      await expect(pg.unsafe('DELETE FROM ticket_events WHERE id = $1', [id])).rejects.toThrow(/append-only/);
    } finally {
      await closePg();
      for (const k of ['__sigapStore', '__sigapSnapshot', '__sigapChain', '__sigapBootstrap']) g[k] = undefined;
      if (saved.driver === undefined) delete process.env.DB_DRIVER;
      else process.env.DB_DRIVER = saved.driver;
      if (saved.dbUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = saved.dbUrl;
    }
  });
});
