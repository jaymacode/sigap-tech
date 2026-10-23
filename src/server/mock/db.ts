import { systemClock } from '@/server/clock';
import { seedStore } from './seed';
import { createEmptyStore, type Store } from './store';
import { runSlaTick } from './ticket-engine';

/**
 * Akses store mock. Disimpan di `globalThis` agar bertahan saat HMR dev dan dipakai bersama
 * oleh semua route dalam satu proses Node.
 *
 * Simulasi worker (ADR-005): setiap akses, jika tick terakhir ≥ 60 detik lalu, jalankan `sla-tick`
 * + `auto-close`. Pada backend asli ini digantikan pg-boss schedule (ARCHITECTURE.md §4).
 */

const TICK_INTERVAL_MS = 60_000;

const globalForStore = globalThis as typeof globalThis & { __sigapStore?: Store };

/**
 * Mengembalikan store (seed otomatis saat pertama kali diakses).
 * @param now - waktu sekarang (default jam sistem)
 */
export function getStore(now: Date = systemClock()): Store {
  let store = globalForStore.__sigapStore;
  if (!store) {
    store = createEmptyStore(now);
    seedStore(store, now);
    globalForStore.__sigapStore = store;
  }
  const last = store.workerLastTick?.getTime() ?? 0;
  if (now.getTime() - last >= TICK_INTERVAL_MS) runSlaTick(store, now);
  return store;
}

/** Reset data demo (setara `make reset`). */
export function resetStore(now: Date = systemClock()): Store {
  globalForStore.__sigapStore = undefined;
  return getStore(now);
}
