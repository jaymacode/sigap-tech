import { systemClock } from '@/server/clock';
import { bootstrapDatabase, resetDatabaseStore } from '@/server/db/bootstrap';
import { hydrateStore, persistDiff, takeSnapshot, type Snapshot } from '@/server/db/persistence';
import { isPostgres } from '@/server/db/config';
import { getPg, hydrateStorePg, persistDiffPg } from '@/server/db/postgres';
import { getSqlite, isDatabaseEnabled } from '@/server/db/sqlite';
import { seedStore } from './seed';
import { createEmptyStore, type Store } from './store';
import { runSlaTick } from './ticket-engine';

const TICK_INTERVAL_MS = 60_000;

const globalForStore = globalThis as typeof globalThis & {
  __sigapStore?: Store;
  __sigapSnapshot?: Snapshot;
  __sigapChain?: Promise<unknown>;
};

/** Installs a synced Store and Snapshot into the process-wide global slot. */
export function installDatabaseStore(store: Store, snapshot: Snapshot): void {
  globalForStore.__sigapStore = store;
  globalForStore.__sigapSnapshot = snapshot;
}

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const prev = globalForStore.__sigapChain ?? Promise.resolve();
  const run = prev.then(task);
  globalForStore.__sigapChain = run.catch(() => undefined);
  return run;
}

async function rehydrate(): Promise<void> {
  const store = isPostgres() ? await hydrateStorePg(getPg()) : hydrateStore(getSqlite());
  installDatabaseStore(store, takeSnapshot(store));
}

/**
 * Returns the active Store.
 * - `memory-only`: auto-seeds in memory on first access.
 * - SQLite mode: requires `initDatabaseStore()` at boot, except in tests or `:memory:` where it
 *   auto-bootstraps synchronously. Runs the 60s SLA tick if due.
 */
export function getStore(now: Date = systemClock()): Store {
  let store = globalForStore.__sigapStore;
  if (!store) {
    if (!isDatabaseEnabled()) {
      store = createEmptyStore(now);
      seedStore(store, now);
      globalForStore.__sigapStore = store;
    } else if (
      !isPostgres() &&
      (process.env.NODE_ENV === 'test' || process.env.DB_PATH === ':memory:')
    ) {
      const outcome = bootstrapDatabase(getSqlite());
      installDatabaseStore(outcome.store, outcome.snapshot);
      store = outcome.store;
    } else {
      throw new Error('Database store belum siap: hydrate dari database belum selesai');
    }
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
 * Persists Store diffs to SQLite in a single serialized transaction.
 * On failure, rolls back SQLite, rehydrates the Store from SQLite, and rethrows.
 */
export function persistStore(): Promise<void> {
  if (!isDatabaseEnabled()) return Promise.resolve();
  return enqueue(async () => {
    const store = globalForStore.__sigapStore;
    const snapshot = globalForStore.__sigapSnapshot;
    if (!store || !snapshot) throw new Error('Database store belum siap');
    try {
      const result = isPostgres()
        ? await persistDiffPg(getPg(), store, snapshot)
        : persistDiff(getSqlite(), store, snapshot);
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

/** Resets the in-memory store (throws when SQLite mode is active). */
export function resetStore(now: Date = systemClock()): Store {
  if (isDatabaseEnabled()) {
    throw new Error('Gunakan resetStoreAsync pada mode database');
  }
  globalForStore.__sigapStore = undefined;
  return getStore(now);
}

/** Resets demo data for both memory-only and SQLite modes. */
export async function resetStoreAsync(now: Date = systemClock()): Promise<Store> {
  if (!isDatabaseEnabled()) return resetStore(now);
  await enqueue(async () => {
    await resetDatabaseStore(now);
  });
  const store = globalForStore.__sigapStore;
  if (!store) throw new Error('Database store belum siap');
  return store;
}
