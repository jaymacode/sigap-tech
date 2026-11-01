import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { initDatabaseStore } from '@/server/db/bootstrap';
import { getPool } from '@/server/db/pool';
import { getStore, persistStore } from '@/server/mock/db';
import { ensureTestDatabase, resetSchema, TEST_DATABASE_URL } from './helpers';

/**
 * Persist yang gagal harus di-rollback dan store di-hydrate ulang dari database.
 * Suite ini memakai jalur produksi: DATABASE_URL + initDatabaseStore + persistStore.
 */
describe.skipIf(!TEST_DATABASE_URL)('persist gagal → rollback dan re-hydrate', () => {
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

  it('getStore sebelum hydrate selesai melempar error (tidak seed diam-diam)', async () => {
    // Kondisi ini diuji dengan slot kosong: dipasang ulang setelah pengecekan.
    const g = globalThis as typeof globalThis & { __sigapStore?: unknown };
    const keep = g.__sigapStore;
    g.__sigapStore = undefined;
    try {
      expect(() => getStore()).toThrow(/belum siap/);
    } finally {
      g.__sigapStore = keep;
    }
  });

  it('persist valid berhasil, lalu persist yang gagal di-rollback dan store dibaca ulang', async () => {
    const store = getStore();
    const agent = [...store.users.values()].find((u) => u.role === 'agent');
    if (!agent) throw new Error('tidak ada agent');

    // Perubahan valid.
    agent.name = `${agent.name} (uji)`;
    await persistStore();
    const row = await admin.query<{ name: string }>('SELECT name FROM users WHERE id = $1', [
      agent.id,
    ]);
    expect(row.rows[0]!.name).toBe(agent.name);

    // Perubahan yang melanggar foreign key (requester tidak ada). FK bersifat DEFERRABLE, jadi
    // error muncul saat COMMIT, dan transaksi harus di-rollback.
    const template = [...store.tickets.values()][0];
    if (!template) throw new Error('tidak ada tiket');
    store.tickets.set('tkt-rusak', {
      ...template,
      id: 'tkt-rusak',
      number: 'INC-999999',
      requesterId: 'usr-tidak-ada',
    });
    await expect(persistStore()).rejects.toThrow();

    const rowsBad = await admin.query('SELECT 1 FROM tickets WHERE id = $1', ['tkt-rusak']);
    expect(rowsBad.rowCount).toBe(0);

    const reloaded = getStore();
    expect(reloaded).not.toBe(store);
    expect(reloaded.tickets.has('tkt-rusak')).toBe(false);
    expect(reloaded.users.get(agent.id)?.name).toBe(agent.name);

    // Chain penulisan tetap hidup setelah kegagalan.
    const fresh = getStore();
    const fresher = [...fresh.users.values()].find((u) => u.role === 'agent');
    if (!fresher) throw new Error('tidak ada agent');
    fresher.name = 'Setelah rollback';
    await persistStore();
    const after = await admin.query<{ name: string }>('SELECT name FROM users WHERE id = $1', [
      fresher.id,
    ]);
    expect(after.rows[0]!.name).toBe('Setelah rollback');
  });
});
