import { SQL } from 'bun';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Store } from '@/server/mock/store';
import {
  BOOLEAN_COLUMNS,
  decodeRow,
  planDiff,
  TIMESTAMP_COLUMNS,
  type PersistResult,
  type Snapshot,
} from './persistence';
import {
  buildStore,
  encodeStore,
  TABLES,
  type Row,
  type RowsByTable,
  type TableDef,
  type TableName,
} from './tables';

/**
 * Store <-> PostgreSQL persistence (`DB_DRIVER=postgres`), via Bun's built-in SQL client.
 *
 * Same contract as the SQLite path in persistence.ts and reuses its diff (`planDiff`) and row
 * codec (`decodeRow` + tables.ts). Dialect differences live only in the three helpers below:
 * - jsonb columns are SELECTed as `col::text`, so `decodeRow` JSON.parses them exactly like SQLite
 *   (Bun would otherwise auto-parse, and a jsonb string scalar would then be ambiguous).
 * - writes cast placeholders (`$n::jsonb`, `::timestamptz`, `::boolean`) and pass JSON/ISO strings.
 * - timestamptz/boolean come back as Date/boolean, which `decodeRow` accepts as-is.
 */

/** Advisory lock key shared by migrations and seeding (one booting process at a time). */
const PG_LOCK_KEY = 727001;
/** Stay well under PostgreSQL's 65535 bind-parameter limit per statement. */
const MAX_PARAMS = 30_000;

type Pg = SQL;

const globalForPg = globalThis as typeof globalThis & { __sigapPg?: SQL };

/** Returns the singleton connection pool for `DATABASE_URL`. */
export function getPg(): SQL {
  if (!globalForPg.__sigapPg) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL belum diset (wajib untuk DB_DRIVER=postgres)');
    globalForPg.__sigapPg = new SQL(url);
  }
  return globalForPg.__sigapPg;
}

export async function closePg(): Promise<void> {
  const pg = globalForPg.__sigapPg;
  globalForPg.__sigapPg = undefined;
  if (pg) await pg.close();
}

// --- dialect helpers (pure) -------------------------------------------------------------------

/** SELECT-list expression for a column. */
export function pgSelectColumn(def: TableDef, col: string): string {
  return def.jsonb.includes(col) ? `${col}::text AS ${col}` : col;
}

/** Placeholder `$n` with an explicit cast where the bound JS value is a string/boolean. */
export function pgPlaceholder(def: TableDef, col: string, n: number): string {
  if (def.jsonb.includes(col)) return `$${n}::jsonb`;
  if (TIMESTAMP_COLUMNS.has(col)) return `$${n}::timestamptz`;
  if (BOOLEAN_COLUMNS.has(col)) return `$${n}::boolean`;
  return `$${n}`;
}

/** Bind value for a column (booleans stay booleans, unlike SQLite's 0/1). */
export function encodePgValue(def: TableDef, col: string, value: unknown): unknown {
  if (value === undefined || value === null) return null;
  if (value instanceof Date) return value.toISOString();
  if (def.jsonb.includes(col)) return JSON.stringify(value);
  return value;
}

// --- read / write -----------------------------------------------------------------------------

async function writeRows(pg: Pg, def: TableDef, rows: Row[], conflict: boolean): Promise<void> {
  const cols = def.columns;
  const nonPk = cols.filter((c) => !def.pk.includes(c));
  const onConflict =
    conflict && nonPk.length > 0
      ? ` ON CONFLICT (${def.pk.join(', ')}) DO UPDATE SET ${nonPk
          .map((c) => `${c} = excluded.${c}`)
          .join(', ')}`
      : '';
  const perChunk = Math.max(1, Math.floor(MAX_PARAMS / cols.length));
  for (let start = 0; start < rows.length; start += perChunk) {
    const chunk = rows.slice(start, start + perChunk);
    const params: unknown[] = [];
    const tuples = chunk.map((row) => {
      const ph = cols.map((c) => {
        params.push(encodePgValue(def, c, row[c]));
        return pgPlaceholder(def, c, params.length);
      });
      return `(${ph.join(', ')})`;
    });
    await pg.unsafe(
      `INSERT INTO ${def.name} (${cols.join(', ')}) VALUES ${tuples.join(', ')}${onConflict}`,
      params,
    );
  }
}

async function deleteRows(pg: Pg, def: TableDef, keys: string[][]): Promise<void> {
  const where = def.pk.map((c, i) => `${c} = $${i + 1}`).join(' AND ');
  for (const keyParts of keys) {
    await pg.unsafe(`DELETE FROM ${def.name} WHERE ${where}`, keyParts);
  }
}

/** Reads all tables and reconstructs a `Store` (run inside a transaction for consistency). */
export async function readStorePg(pg: Pg): Promise<Store> {
  const data = {} as RowsByTable;
  for (const def of TABLES) {
    const order = def.columns.includes('ord') ? 'ord' : def.pk.join(', ');
    const select = def.columns.map((c) => pgSelectColumn(def, c)).join(', ');
    const rows = (await pg.unsafe(`SELECT ${select} FROM ${def.name} ORDER BY ${order}`)) as Row[];
    data[def.name as TableName] = [...rows].map((r) => decodeRow(def, r));
  }
  return buildStore(data);
}

/** Hydrates a `Store` inside a read transaction. */
export function hydrateStorePg(pg: SQL): Promise<Store> {
  return pg.begin((tx) => readStorePg(tx));
}

/** Inserts every Store row within the caller's transaction (FKs are DEFERRABLE). */
export async function insertAllPg(pg: Pg, store: Store): Promise<void> {
  const rows = encodeStore(store);
  for (const def of TABLES) {
    const tableRows = rows[def.name as TableName];
    if (tableRows.length > 0) await writeRows(pg, def, tableRows, false);
  }
}

/** Persists the diff between `store` and `previous` in one transaction (rolls back on error). */
export async function persistDiffPg(
  pg: SQL,
  store: Store,
  previous: Snapshot,
): Promise<PersistResult> {
  const started = performance.now();
  const { counts, next, plans, empty } = planDiff(store, previous);
  if (!empty) {
    await pg.begin(async (tx) => {
      for (let i = plans.length - 1; i >= 0; i--) {
        const plan = plans[i];
        if (plan && plan.deletes.length > 0) await deleteRows(tx, plan.def, plan.deletes);
      }
      for (const { def, upserts } of plans) {
        if (upserts.length > 0) await writeRows(tx, def, upserts, !def.appendOnly);
      }
    });
  }
  return { counts, snapshot: next, durationMs: performance.now() - started };
}

// --- migrations / boot helpers ----------------------------------------------------------------

function resolvePgMigrationsDir(): string {
  const fromModule = join(import.meta.dir, '..', '..', '..', 'db', 'postgres');
  if (existsSync(join(fromModule, '0001_init.sql'))) return fromModule;
  return join(process.cwd(), 'db', 'postgres');
}

/** Takes the boot advisory lock for the rest of the caller's transaction. */
export async function lockPg(tx: Pg): Promise<void> {
  await tx.unsafe('SELECT pg_advisory_xact_lock($1)', [PG_LOCK_KEY]);
}

/** Applies unapplied `db/postgres/*.sql` files in order, all in one locked transaction. */
export function runPgMigrations(pg: SQL): Promise<string[]> {
  const dir = resolvePgMigrationsDir();
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  return pg.begin(async (tx) => {
    await lockPg(tx);
    await tx.unsafe(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id         text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`);
    const done = (await tx.unsafe('SELECT id FROM schema_migrations')) as Array<{ id: string }>;
    const seen = new Set([...done].map((r) => r.id));
    const applied: string[] = [];
    for (const file of files) {
      if (seen.has(file)) continue;
      await tx.unsafe(readFileSync(join(dir, file), 'utf8'));
      await tx.unsafe('INSERT INTO schema_migrations (id) VALUES ($1)', [file]);
      applied.push(file);
    }
    return applied;
  });
}

/** True when the database holds no users and no tickets (fresh install). */
export async function isEmptyPg(tx: Pg): Promise<boolean> {
  const rows = (await tx.unsafe(
    'SELECT (NOT EXISTS (SELECT 1 FROM users) AND NOT EXISTS (SELECT 1 FROM tickets)) AS empty',
  )) as Array<{ empty: boolean }>;
  return rows[0]?.empty === true;
}

/** Health ping in the same shape as the SQLite check in routes/api.ts. */
export async function checkPostgres(): Promise<{ enabled: boolean; ok?: boolean; latencyMs?: number }> {
  const started = Date.now();
  try {
    await getPg().unsafe('SELECT 1');
    return { enabled: true, ok: true, latencyMs: Date.now() - started };
  } catch {
    return { enabled: true, ok: false, latencyMs: Date.now() - started };
  }
}
