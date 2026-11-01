import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootstrapDatabase } from '@/server/db/bootstrap';
import { ensureTestDatabase, resetSchema, TEST_DATABASE_URL } from './helpers';

describe.skipIf(!TEST_DATABASE_URL)('bootstrap', () => {
  let poolA: Pool;
  let poolB: Pool;

  beforeAll(async () => {
    await ensureTestDatabase(TEST_DATABASE_URL!);
    poolA = new Pool({ connectionString: TEST_DATABASE_URL, max: 3 });
    poolB = new Pool({ connectionString: TEST_DATABASE_URL, max: 3 });
    await resetSchema(poolA);
  });

  afterAll(async () => {
    await poolA.end();
    await poolB.end();
  });

  it('dua bootstrap bersamaan (dua proses) hanya men-seed sekali', async () => {
    const [a, b] = await Promise.all([bootstrapDatabase(poolA), bootstrapDatabase(poolB)]);
    const modes = [a.summary.mode, b.summary.mode].sort();
    expect(modes).toEqual(['hydrated', 'seeded']);

    const applied = [...a.summary.migrationsApplied, ...b.summary.migrationsApplied];
    expect(applied).toEqual(['0001_init.sql']);

    const tickets = await poolA.query<{ n: string }>('SELECT count(*) AS n FROM tickets');
    const users = await poolA.query<{ n: string }>('SELECT count(*) AS n FROM users');
    expect(Number(tickets.rows[0]!.n)).toBe(a.store.tickets.size);
    expect(Number(users.rows[0]!.n)).toBe(a.store.users.size);
    expect(b.store.tickets.size).toBe(a.store.tickets.size);
  });

  it('bootstrap kedua (database sudah berisi) hanya hydrate tanpa seed ulang', async () => {
    const again = await bootstrapDatabase(poolA);
    expect(again.summary.mode).toBe('hydrated');
    expect(again.summary.migrationsApplied).toEqual([]);
    expect(again.summary.rowCounts.tickets).toBeGreaterThan(600);
    console.log(`[timing] bootstrap hydrate ${again.summary.durationMs.toFixed(0)} ms`);
  });
});
