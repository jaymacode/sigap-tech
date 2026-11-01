import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '@/server/db/migrate';
import { saveAll } from '@/server/db/persistence';
import { ensureTestDatabase, NOW, resetSchema, seededStore, TEST_DATABASE_URL } from './helpers';

describe.skipIf(!TEST_DATABASE_URL)('ticket_events append-only', () => {
  let pool: Pool;

  beforeAll(async () => {
    await ensureTestDatabase(TEST_DATABASE_URL!);
    pool = new Pool({ connectionString: TEST_DATABASE_URL, max: 4 });
    await resetSchema(pool);
    await runMigrations(pool);
    await saveAll(pool, seededStore(NOW));
  });

  afterAll(async () => {
    await pool.end();
  });

  it('UPDATE ditolak trigger', async () => {
    await expect(pool.query('UPDATE ticket_events SET type = type')).rejects.toThrow(/append-only/);
  });

  it('DELETE ditolak trigger', async () => {
    await expect(pool.query('DELETE FROM ticket_events')).rejects.toThrow(/append-only/);
  });

  it('TRUNCATE ditolak trigger', async () => {
    await expect(pool.query('TRUNCATE ticket_events')).rejects.toThrow(/append-only/);
  });

  it('data tidak berubah setelah percobaan di atas', async () => {
    const res = await pool.query<{ n: string }>('SELECT count(*) AS n FROM ticket_events');
    expect(Number(res.rows[0]!.n)).toBeGreaterThan(0);
  });
});
