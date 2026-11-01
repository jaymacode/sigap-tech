import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { initDatabaseStore, resetDatabaseStore } from '@/server/db/bootstrap';
import { getPool } from '@/server/db/pool';
import { getStore } from '@/server/mock/db';
import { ensureTestDatabase, resetSchema, TEST_DATABASE_URL } from './helpers';

/** Reset demo harus bisa mengosongkan tabel append-only tanpa menonaktifkan trigger secara permanen. */
describe.skipIf(!TEST_DATABASE_URL)('resetDatabaseStore', () => {
  let admin: Pool;
  const savedUrl = process.env.DATABASE_URL;

  beforeAll(async () => {
    await ensureTestDatabase(TEST_DATABASE_URL!);
    admin = new Pool({ connectionString: TEST_DATABASE_URL, max: 2 });
    await resetSchema(admin);
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    await initDatabaseStore();
  });

  afterAll(async () => {
    await getPool().end();
    await admin.end();
    if (savedUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = savedUrl;
  });

  it('mengosongkan dan men-seed ulang tanpa menggandakan baris append-only', async () => {
    const eventsBefore = await admin.query<{ n: string }>(
      'SELECT count(*) AS n FROM ticket_events',
    );
    expect(Number(eventsBefore.rows[0]!.n)).toBeGreaterThan(0);

    const summary = await resetDatabaseStore();
    expect(summary.mode).toBe('seeded');

    const store = getStore();
    const eventsInStore = [...store.events.values()].flat().length;
    const eventsAfter = await admin.query<{ n: string }>('SELECT count(*) AS n FROM ticket_events');
    expect(Number(eventsAfter.rows[0]!.n)).toBe(eventsInStore);

    const tickets = await admin.query<{ n: string }>('SELECT count(*) AS n FROM tickets');
    expect(Number(tickets.rows[0]!.n)).toBe(store.tickets.size);

    const migrations = await admin.query<{ n: string }>(
      'SELECT count(*) AS n FROM schema_migrations',
    );
    expect(migrations.rows[0]!.n).toBe('1');
  });

  it('trigger append-only tetap aktif setelah reset', async () => {
    const trg = await admin.query<{ tgenabled: string }>(
      "SELECT tgenabled FROM pg_trigger WHERE tgname = 'ticket_events_no_truncate'",
    );
    expect(trg.rows[0]!.tgenabled).toBe('O');
    await expect(admin.query('TRUNCATE ticket_events')).rejects.toThrow(/append-only/);
    await expect(admin.query('UPDATE ticket_events SET type = type')).rejects.toThrow(
      /append-only/,
    );
  });
});
