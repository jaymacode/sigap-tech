import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '@/server/db/migrate';
import { ensureTestDatabase, resetSchema, TEST_DATABASE_URL } from './helpers';

describe.skipIf(!TEST_DATABASE_URL)('migrasi', () => {
  let pool: Pool;

  beforeAll(async () => {
    await ensureTestDatabase(TEST_DATABASE_URL!);
    pool = new Pool({ connectionString: TEST_DATABASE_URL, max: 4 });
    await resetSchema(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('menerapkan migrasi pada schema kosong', async () => {
    const applied = await runMigrations(pool);
    expect(applied).toEqual(['0001_init.sql']);
    const tables = await pool.query<{ table_name: string }>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'",
    );
    const names = tables.rows.map((r) => r.table_name);
    for (const t of [
      'tickets',
      'ticket_events',
      'sla_instances',
      'app_state',
      'schema_migrations',
    ]) {
      expect(names).toContain(t);
    }
  });

  it('idempotent: menjalankan ulang tidak menerapkan apa pun', async () => {
    expect(await runMigrations(pool)).toEqual([]);
    const count = await pool.query<{ n: string }>('SELECT count(*) AS n FROM schema_migrations');
    expect(count.rows[0]!.n).toBe('1');
  });

  it('dua proses yang migrasi bersamaan tidak saling bentrok', async () => {
    await resetSchema(pool);
    const other = new Pool({ connectionString: TEST_DATABASE_URL, max: 2 });
    try {
      const [a, b] = await Promise.all([runMigrations(pool), runMigrations(other)]);
      expect([...a, ...b]).toEqual(['0001_init.sql']);
    } finally {
      await other.end();
    }
  });
});
