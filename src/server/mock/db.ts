import { systemClock } from '@/server/clock';
import { getPool, isDatabaseEnabled } from '@/server/db/pool';
import { hydrateStore, persistDiff, takeSnapshot, type Snapshot } from '@/server/db/persistence';
import { seedStore } from './seed';
import { createEmptyStore, type Store } from './store';
import { runSlaTick } from './ticket-engine';

/**
 * Akses store. Disimpan di `globalThis` agar bertahan saat HMR dev dan dipakai bersama
 * oleh semua route dalam satu proses Node.
 *
 * Mode tanpa `DATABASE_URL` (unit test, `next build`, UI lokal): store in-memory yang di-seed.
 * Mode database (`DATABASE_URL`): PostgreSQL adalah sistem of record. Store di-hydrate saat start
 * (lihat server/db/bootstrap.ts), setiap mutasi diikuti `await persistStore()`, dan penulisan
 * diserialkan lewat satu rantai promise (single writer).
 *
 * Simulasi worker (ADR-005): setiap akses, jika tick terakhir ≥ 60 detik lalu, jalankan `sla-tick`
 * + `auto-close`. Pada backend asli ini digantikan pg-boss schedule (ARCHITECTURE.md §4).
 */

const TICK_INTERVAL_MS = 60_000;

const globalForStore = globalThis as typeof globalThis & {
  __sigapStore?: Store;
  /** Snapshot keadaan store yang terakhir tersimpan di database (basis diff). */
  __sigapSnapshot?: Snapshot;
  /** Ekor rantai penulisan; tidak pernah reject. */
  __sigapChain?: Promise<unknown>;
};

/**
 * Memasang store dan snapshot ke slot global (dipakai hydrate/seed/reset).
 * @param store - store yang sudah sinkron dengan database
 * @param snapshot - snapshot dari store tersebut
 */
export function installDatabaseStore(store: Store, snapshot: Snapshot): void {
  globalForStore.__sigapStore = store;
  globalForStore.__sigapSnapshot = snapshot;
}

/** Menjalankan tugas penulisan secara berurutan (satu writer per proses). */
function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const prev = globalForStore.__sigapChain ?? Promise.resolve();
  const run = prev.then(task);
  globalForStore.__sigapChain = run.catch(() => undefined);
  return run;
}

/** Membaca ulang store dari database setelah gagal menulis (memory tidak boleh menyimpang). */
async function rehydrate(): Promise<void> {
  const store = await hydrateStore(getPool());
  installDatabaseStore(store, takeSnapshot(store));
}

/**
 * Mengembalikan store.
 * - Mode in-memory: seed otomatis saat pertama kali diakses.
 * - Mode database: harus sudah di-hydrate oleh bootstrap; jika belum, lempar error (tidak seed diam-diam).
 * @param now - waktu sekarang (default jam sistem)
 */
export function getStore(now: Date = systemClock()): Store {
  let store = globalForStore.__sigapStore;
  if (!store) {
    if (isDatabaseEnabled()) {
      throw new Error('Database store belum siap: hydrate dari PostgreSQL belum selesai');
    }
    store = createEmptyStore(now);
    seedStore(store, now);
    globalForStore.__sigapStore = store;
  }
  const last = store.workerLastTick?.getTime() ?? 0;
  if (now.getTime() - last >= TICK_INTERVAL_MS) {
    runSlaTick(store, now);
    if (isDatabaseEnabled()) {
      persistStore().catch((err: unknown) => {
        console.error('[db] gagal menyimpan SLA tick', err);
      });
    }
  }
  return store;
}

/**
 * Menyimpan perubahan store ke database (diff terhadap snapshot, satu transaksi).
 * No-op jika database tidak aktif. Jika gagal: transaksi di-rollback, store di-hydrate ulang dari
 * database, dan error dilempar kembali.
 */
export function persistStore(): Promise<void> {
  if (!isDatabaseEnabled()) return Promise.resolve();
  return enqueue(async () => {
    const store = globalForStore.__sigapStore;
    const snapshot = globalForStore.__sigapSnapshot;
    if (!store || !snapshot) throw new Error('Database store belum siap');
    try {
      const result = await persistDiff(getPool(), store, snapshot);
      globalForStore.__sigapSnapshot = result.snapshot;
    } catch (err) {
      globalForStore.__sigapStore = undefined;
      globalForStore.__sigapSnapshot = undefined;
      try {
        await rehydrate();
      } catch (reloadErr) {
        console.error('[db] hydrate ulang setelah gagal menyimpan juga gagal', reloadErr);
      }
      throw err;
    }
  });
}

/** Reset data demo (setara `make reset`), mode in-memory. */
export function resetStore(now: Date = systemClock()): Store {
  if (isDatabaseEnabled()) {
    throw new Error('Gunakan resetStoreAsync pada mode database');
  }
  globalForStore.__sigapStore = undefined;
  return getStore(now);
}

/**
 * Reset data demo untuk kedua mode. Mode database: kosongkan tabel, seed ulang, lalu pasang store
 * baru. Dijalankan lewat rantai penulisan agar tidak bertabrakan dengan persistStore.
 * @param now - waktu seed
 */
export async function resetStoreAsync(now: Date = systemClock()): Promise<Store> {
  if (!isDatabaseEnabled()) return resetStore(now);
  await enqueue(async () => {
    const { resetDatabaseStore } = await import('@/server/db/bootstrap');
    await resetDatabaseStore(now);
  });
  const store = globalForStore.__sigapStore;
  if (!store) throw new Error('Database store belum siap');
  return store;
}
