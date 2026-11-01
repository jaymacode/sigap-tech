import type { Pool } from 'pg';
import { systemClock } from '@/server/clock';
import { installDatabaseStore } from '@/server/mock/db';
import { createEmptyStore, type Store } from '@/server/mock/store';
import { seedStore } from '@/server/mock/seed';
import { runMigrations } from './migrate';
import { getPool } from './pool';
import {
  insertAll,
  readStoreWith,
  snapshotCounts,
  takeSnapshot,
  type Snapshot,
} from './persistence';
import { TABLE_NAMES, type TableName } from './tables';

/** Kunci advisory lock untuk seed/reset demo (dipakai bersama scripts/migrate.js). */
export const SEED_LOCK_KEY = 727002;

export interface BootstrapSummary {
  migrationsApplied: string[];
  /** `seeded` = database kosong lalu diisi data demo; `hydrated` = dibaca dari database. */
  mode: 'seeded' | 'hydrated';
  rowCounts: Record<TableName, number>;
  durationMs: number;
}

interface BootstrapOutcome {
  store: Store;
  snapshot: Snapshot;
  summary: BootstrapSummary;
}

const globalForBootstrap = globalThis as typeof globalThis & {
  __sigapBootstrap?: Promise<BootstrapSummary>;
};

/**
 * Migrasi, lalu hydrate jika ada data, atau seed jika `users` dan `tickets` kosong.
 * Seed dan pemeriksaan kosong berjalan di satu transaksi di bawah advisory lock, sehingga dua
 * proses yang start bersamaan tidak akan meng-seed dua kali.
 * Tidak menyentuh globalThis (aman dipanggil dari tes dengan pool sendiri).
 * @param pool - pool koneksi
 */
export async function bootstrapDatabase(pool: Pool): Promise<BootstrapOutcome> {
  const started = performance.now();
  const migrationsApplied = await runMigrations(pool);

  const client = await pool.connect();
  let store: Store;
  let mode: BootstrapSummary['mode'];
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [SEED_LOCK_KEY]);
    const empty = await client.query<{ empty: boolean }>(
      'SELECT (NOT EXISTS (SELECT 1 FROM users) AND NOT EXISTS (SELECT 1 FROM tickets)) AS empty',
    );
    if (empty.rows[0]?.empty === true) {
      const now = systemClock();
      store = createEmptyStore(now);
      seedStore(store, now);
      await insertAll(client, store);
      mode = 'seeded';
    } else {
      store = await readStoreWith(client);
      mode = 'hydrated';
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  const snapshot = takeSnapshot(store);
  const summary: BootstrapSummary = {
    migrationsApplied,
    mode,
    rowCounts: snapshotCounts(snapshot),
    durationMs: performance.now() - started,
  };
  return { store, snapshot, summary };
}

/**
 * Inisialisasi untuk proses Next (dipanggil dari instrumentation.register). Memasang Store hasil
 * hydrate/seed ke slot `getStore()`. Dipanggil ulang = mengembalikan hasil yang sama.
 */
export function initDatabaseStore(): Promise<BootstrapSummary> {
  if (!globalForBootstrap.__sigapBootstrap) {
    const run = (async () => {
      const { store, snapshot, summary } = await bootstrapDatabase(getPool());
      installDatabaseStore(store, snapshot);
      return summary;
    })();
    globalForBootstrap.__sigapBootstrap = run;
    run.catch(() => {
      // Izinkan percobaan ulang setelah gagal.
      globalForBootstrap.__sigapBootstrap = undefined;
    });
  }
  return globalForBootstrap.__sigapBootstrap;
}

/**
 * Reset data demo: mengosongkan semua tabel lalu meng-seed ulang, dalam satu transaksi.
 *
 * Trigger append-only pada `ticket_events` menolak TRUNCATE. Trigger itu DINONAKTIFKAN hanya di
 * dalam transaksi reset ini (`ALTER TABLE ... DISABLE TRIGGER USER`, hanya butuh pemilik tabel,
 * bukan superuser) lalu diaktifkan kembali sebelum COMMIT. DDL PostgreSQL transaksional, jadi jika
 * ada langkah yang gagal, seluruh reset di-rollback dan trigger tetap aktif.
 * Tabel `schema_migrations` tidak ikut dikosongkan.
 * @param now - waktu seed
 */
export async function resetDatabaseStore(now: Date = systemClock()): Promise<BootstrapSummary> {
  const started = performance.now();
  const pool = getPool();
  const client = await pool.connect();
  let store: Store;
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [SEED_LOCK_KEY]);
    await client.query('ALTER TABLE ticket_events DISABLE TRIGGER USER');
    await client.query(`TRUNCATE ${TABLE_NAMES.join(', ')}`);
    await client.query('ALTER TABLE ticket_events ENABLE TRIGGER USER');
    store = createEmptyStore(now);
    seedStore(store, now);
    await insertAll(client, store);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  const snapshot = takeSnapshot(store);
  installDatabaseStore(store, snapshot);
  return {
    migrationsApplied: [],
    mode: 'seeded',
    rowCounts: snapshotCounts(snapshot),
    durationMs: performance.now() - started,
  };
}
