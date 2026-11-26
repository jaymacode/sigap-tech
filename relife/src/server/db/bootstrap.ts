import type { Database } from 'bun:sqlite';
import type { SQL } from 'bun';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { systemClock } from '@/server/clock';
import { installDatabaseStore } from '@/server/mock/db';
import { seedStore } from '@/server/mock/seed';
import { createEmptyStore, type Store } from '@/server/mock/store';
import {
  insertAll,
  readStoreWith,
  snapshotCounts,
  takeSnapshot,
  type Snapshot,
} from './persistence';
import { isPostgres } from './config';
import {
  getPg,
  insertAllPg,
  isEmptyPg,
  lockPg,
  readStorePg,
  runPgMigrations,
} from './postgres';
import { getSqlite } from './sqlite';
import { TABLE_NAMES, type TableName } from './tables';

export interface BootstrapSummary {
  migrationsApplied: string[];
  mode: 'seeded' | 'hydrated';
  rowCounts: Record<TableName, number>;
  durationMs: number;
}

export interface BootstrapOutcome {
  store: Store;
  snapshot: Snapshot;
  summary: BootstrapSummary;
}

const globalForBootstrap = globalThis as typeof globalThis & {
  __sigapBootstrap?: Promise<BootstrapSummary>;
};

const TICKET_EVENTS_TRIGGERS_SQL = `
CREATE TRIGGER ticket_events_no_update
  BEFORE UPDATE ON ticket_events
BEGIN
  SELECT RAISE(ABORT, 'ticket_events is append-only: UPDATE is not allowed');
END;

CREATE TRIGGER ticket_events_no_delete
  BEFORE DELETE ON ticket_events
BEGIN
  SELECT RAISE(ABORT, 'ticket_events is append-only: DELETE is not allowed');
END;
`;

function resolveMigrationsDir(): string {
  const fromModule = join(import.meta.dir, '..', '..', '..', 'db');
  if (existsSync(join(fromModule, '0001_init.sql'))) return fromModule;
  return join(process.cwd(), 'db');
}

/** Applies unapplied SQL migration files from `relife/db/*.sql` in order. */
export function runMigrations(db: Database): string[] {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id         TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `);
  const dir = resolveMigrationsDir();
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  const seen = new Set(
    (db.prepare('SELECT id FROM schema_migrations').all() as Array<{ id: string }>).map(
      (r) => r.id,
    ),
  );
  const applied: string[] = [];
  const insertStmt = db.prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)');
  try {
    for (const file of files) {
      if (seen.has(file)) continue;
      const sql = readFileSync(join(dir, file), 'utf8');
      db.transaction(() => {
        db.exec(sql);
        insertStmt.run(file, systemClock().toISOString());
      })();
      applied.push(file);
    }
  } finally {
    insertStmt.finalize();
  }
  return applied;
}

/** Migrates SQLite, then hydrates existing data or seeds demo data if empty. */
export function bootstrapDatabase(db: Database): BootstrapOutcome {
  const started = performance.now();
  const migrationsApplied = runMigrations(db);

  let store!: Store;
  let mode!: BootstrapSummary['mode'];
  db.exec('PRAGMA defer_foreign_keys = ON');
  db.transaction(() => {
    db.exec('PRAGMA defer_foreign_keys = ON');
    const row = db
      .prepare(
        'SELECT (NOT EXISTS (SELECT 1 FROM users) AND NOT EXISTS (SELECT 1 FROM tickets)) AS empty',
      )
      .get() as { empty: number };
    if (row.empty === 1) {
      const now = systemClock();
      store = createEmptyStore(now);
      seedStore(store, now);
      insertAll(db, store);
      mode = 'seeded';
    } else {
      store = readStoreWith(db);
      mode = 'hydrated';
    }
  })();

  const snapshot = takeSnapshot(store);
  const summary: BootstrapSummary = {
    migrationsApplied,
    mode,
    rowCounts: snapshotCounts(snapshot),
    durationMs: performance.now() - started,
  };
  return { store, snapshot, summary };
}

/** PostgreSQL counterpart of `bootstrapDatabase`: migrate, then hydrate or seed when empty. */
export async function bootstrapPostgres(pg: SQL): Promise<BootstrapOutcome> {
  const started = performance.now();
  const migrationsApplied = await runPgMigrations(pg);
  const { store, mode } = await pg.begin(async (tx) => {
    await lockPg(tx);
    if (await isEmptyPg(tx)) {
      const now = systemClock();
      const seeded = createEmptyStore(now);
      seedStore(seeded, now);
      await insertAllPg(tx, seeded);
      return { store: seeded, mode: 'seeded' as const };
    }
    return { store: await readStorePg(tx), mode: 'hydrated' as const };
  });
  const snapshot = takeSnapshot(store);
  return {
    store,
    snapshot,
    summary: {
      migrationsApplied,
      mode,
      rowCounts: snapshotCounts(snapshot),
      durationMs: performance.now() - started,
    },
  };
}

/** Initializes the singleton store at server boot from the configured driver (idempotent). */
export function initDatabaseStore(): Promise<BootstrapSummary> {
  if (!globalForBootstrap.__sigapBootstrap) {
    const run = Promise.resolve().then(async () => {
      const { store, snapshot, summary } = isPostgres()
        ? await bootstrapPostgres(getPg())
        : bootstrapDatabase(getSqlite());
      installDatabaseStore(store, snapshot);
      return summary;
    });
    globalForBootstrap.__sigapBootstrap = run;
    run.catch(() => {
      globalForBootstrap.__sigapBootstrap = undefined;
    });
  }
  return globalForBootstrap.__sigapBootstrap;
}

/**
 * Resets demo data by clearing all Store tables (temporarily dropping and recreating the
 * append-only triggers on `ticket_events` inside one transaction) and re-seeding.
 */
export async function resetDatabaseStore(now: Date = systemClock()): Promise<BootstrapSummary> {
  if (isPostgres()) return resetPostgresStore(now);
  const started = performance.now();
  const db = getSqlite();
  let store!: Store;

  db.exec('PRAGMA defer_foreign_keys = ON');
  db.transaction(() => {
    db.exec('PRAGMA defer_foreign_keys = ON');
    db.exec(`
      DROP TRIGGER IF EXISTS ticket_events_no_update;
      DROP TRIGGER IF EXISTS ticket_events_no_delete;
    `);
    for (let i = TABLE_NAMES.length - 1; i >= 0; i--) {
      const table = TABLE_NAMES[i];
      if (table) db.exec(`DELETE FROM ${table}`);
    }
    db.exec(TICKET_EVENTS_TRIGGERS_SQL);

    store = createEmptyStore(now);
    seedStore(store, now);
    insertAll(db, store);
  })();

  const snapshot = takeSnapshot(store);
  installDatabaseStore(store, snapshot);
  return {
    migrationsApplied: [],
    mode: 'seeded',
    rowCounts: snapshotCounts(snapshot),
    durationMs: performance.now() - started,
  };
}

/** PostgreSQL reset: append-only triggers are disabled only inside this one transaction. */
async function resetPostgresStore(now: Date): Promise<BootstrapSummary> {
  const started = performance.now();
  const store = createEmptyStore(now);
  seedStore(store, now);
  await getPg().begin(async (tx) => {
    await lockPg(tx);
    await tx.unsafe('ALTER TABLE ticket_events DISABLE TRIGGER USER');
    for (let i = TABLE_NAMES.length - 1; i >= 0; i--) {
      const table = TABLE_NAMES[i];
      if (table) await tx.unsafe(`DELETE FROM ${table}`);
    }
    await tx.unsafe('ALTER TABLE ticket_events ENABLE TRIGGER USER');
    await insertAllPg(tx, store);
  });
  const snapshot = takeSnapshot(store);
  installDatabaseStore(store, snapshot);
  return {
    migrationsApplied: [],
    mode: 'seeded',
    rowCounts: snapshotCounts(snapshot),
    durationMs: performance.now() - started,
  };
}
