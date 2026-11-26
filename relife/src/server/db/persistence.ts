import type { Database, SQLQueryBindings } from 'bun:sqlite';
import type { Store } from '@/server/mock/store';
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
 * Store <-> SQLite persistence.
 *
 * - `Snapshot`: per-table Map of pk -> canonical serialized row for diffing.
 * - `persistDiff`: writes only inserted/updated rows and deletes removed rows in one transaction.
 * - `ticket_events` is append-only (enforced both here and by SQLite triggers).
 */

export type Snapshot = Record<TableName, Map<string, string>>;

export interface TableCount {
  upserted: number;
  deleted: number;
}

export interface PersistResult {
  counts: Record<TableName, TableCount>;
  snapshot: Snapshot;
  durationMs: number;
}

const KEY_SEP = '\u0001';

export const BOOLEAN_COLUMNS = new Set([
  'is_active',
  'auto_assign',
  'is_default',
  'priority_overridden',
  'is_major',
]);

export const TIMESTAMP_COLUMNS = new Set([
  'last_login_at',
  'created_at',
  'updated_at',
  'started_at',
  'finished_at',
  'running_since',
  'paused_at',
  'stopped_at',
  'warn_at',
  'due_at',
  'warned_at',
  'breached_at',
  'first_response_at',
  'resolved_at',
  'closed_at',
  'read_at',
  'sent_at',
  'next_attempt_at',
  'expires_at',
  'decided_at',
]);

interface IndexedRow {
  row: Row;
  ser: string;
}

/** Canonical JSON with sorted object keys so diffing ignores key-order differences. */
function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => {
    if (v === null || typeof v !== 'object' || Array.isArray(v)) return v;
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(v).sort()) sorted[k] = (v as Record<string, unknown>)[k];
    return sorted;
  });
}

function indexRows(def: TableDef, rows: Row[]): Map<string, IndexedRow> {
  const out = new Map<string, IndexedRow>();
  for (const row of rows) {
    const key = def.pk.map((c) => String(row[c])).join(KEY_SEP);
    out.set(key, { row, ser: canonicalJson(def.columns.map((c) => row[c] ?? null)) });
  }
  return out;
}

function toSnapshot(rows: Record<TableName, Row[]>): Snapshot {
  const snap = {} as Snapshot;
  for (const def of TABLES) {
    const name = def.name as TableName;
    const map = new Map<string, string>();
    for (const [key, { ser }] of indexRows(def, rows[name])) map.set(key, ser);
    snap[name] = map;
  }
  return snap;
}

/** Takes a snapshot of the current Store state for subsequent `persistDiff` calls. */
export function takeSnapshot(store: Store): Snapshot {
  return toSnapshot(encodeStore(store));
}

/** Row counts per table from a snapshot. */
export function snapshotCounts(snapshot: Snapshot): Record<TableName, number> {
  const out = {} as Record<TableName, number>;
  for (const def of TABLES) out[def.name as TableName] = snapshot[def.name as TableName].size;
  return out;
}

function encodeValue(def: TableDef, column: string, value: unknown): SQLQueryBindings {
  if (value === undefined || value === null) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (def.jsonb.includes(column)) return JSON.stringify(value);
  return value as SQLQueryBindings;
}

export function decodeRow(def: TableDef, raw: Row): Row {
  const out: Row = {};
  for (const col of def.columns) {
    const val = raw[col];
    if (val === undefined || val === null) {
      out[col] = null;
    } else if (def.jsonb.includes(col)) {
      out[col] = JSON.parse(val as string);
    } else if (BOOLEAN_COLUMNS.has(col)) {
      out[col] = Boolean(val);
    } else if (TIMESTAMP_COLUMNS.has(col)) {
      out[col] = new Date(val as string);
    } else {
      out[col] = val;
    }
  }
  return out;
}

function writeRows(db: Database, def: TableDef, rows: Row[], conflict: boolean): void {
  const cols = def.columns;
  const placeholders = cols.map(() => '?').join(', ');
  const nonPk = cols.filter((c) => !def.pk.includes(c));
  const onConflict =
    conflict && nonPk.length > 0
      ? ` ON CONFLICT (${def.pk.join(', ')}) DO UPDATE SET ${nonPk
          .map((c) => `${c} = excluded.${c}`)
          .join(', ')}`
      : '';
  const stmt = db.prepare(
    `INSERT INTO ${def.name} (${cols.join(', ')}) VALUES (${placeholders})${onConflict}`,
  );
  try {
    for (const row of rows) {
      stmt.run(...cols.map((c) => encodeValue(def, c, row[c])));
    }
  } finally {
    stmt.finalize();
  }
}

function deleteRows(db: Database, def: TableDef, keys: string[][]): void {
  const where = def.pk.map((c) => `${c} = ?`).join(' AND ');
  const stmt = db.prepare(`DELETE FROM ${def.name} WHERE ${where}`);
  try {
    for (const keyParts of keys) {
      stmt.run(...keyParts);
    }
  } finally {
    stmt.finalize();
  }
}

/** Reads all tables from SQLite and reconstructs a `Store`. */
export function readStoreWith(db: Database): Store {
  const data = {} as RowsByTable;
  for (const def of TABLES) {
    const name = def.name as TableName;
    const order = def.columns.includes('ord') ? 'ord' : def.pk.join(', ');
    const stmt = db.prepare(`SELECT ${def.columns.join(', ')} FROM ${def.name} ORDER BY ${order}`);
    try {
      const rows = stmt.all() as Row[];
      data[name] = rows.map((r) => decodeRow(def, r));
    } finally {
      stmt.finalize();
    }
  }
  return buildStore(data);
}

/** Hydrates a `Store` from SQLite inside a consistent read transaction. */
export function hydrateStore(db: Database): Store {
  return db.transaction(() => readStoreWith(db))();
}

/** Inserts all Store rows into SQLite within the caller's transaction. */
export function insertAll(db: Database, store: Store): void {
  const rows = encodeStore(store);
  for (const def of TABLES) {
    const tableRows = rows[def.name as TableName];
    if (tableRows.length > 0) writeRows(db, def, tableRows, false);
  }
}

/** Writes the entire Store in a single deferred-FK transaction. */
export function saveAll(db: Database, store: Store): void {
  db.exec('PRAGMA defer_foreign_keys = ON');
  db.transaction(() => {
    db.exec('PRAGMA defer_foreign_keys = ON');
    insertAll(db, store);
  })();
}

export interface DiffPlan {
  counts: Record<TableName, TableCount>;
  next: Snapshot;
  /** Per table in insert order (parents first). */
  plans: Array<{ def: TableDef; upserts: Row[]; deletes: string[][] }>;
  empty: boolean;
}

/**
 * Computes the per-table diff between `store` and `previous` (driver-independent).
 * Throws on append-only violations before anything is written.
 */
export function planDiff(store: Store, previous: Snapshot): DiffPlan {
  const rows = encodeStore(store);
  const counts = {} as Record<TableName, TableCount>;
  const next = {} as Snapshot;
  const plans: DiffPlan['plans'] = [];

  for (const def of TABLES) {
    const name = def.name as TableName;
    const current = indexRows(def, rows[name]);
    const prev = previous[name];
    const upserts: Row[] = [];
    const snap = new Map<string, string>();
    for (const [key, { row, ser }] of current) {
      snap.set(key, ser);
      if (prev.get(key) !== ser) {
        if (def.appendOnly && prev.has(key)) {
          throw new Error(`${name} bersifat append-only: baris ${key} berubah`);
        }
        upserts.push(row);
      }
    }
    const deletes: string[][] = [];
    for (const key of prev.keys()) {
      if (!current.has(key)) deletes.push(key.split(KEY_SEP));
    }
    if (def.appendOnly && deletes.length > 0) {
      throw new Error(`${name} bersifat append-only: ${deletes.length} baris akan dihapus`);
    }
    next[name] = snap;
    counts[name] = { upserted: upserts.length, deleted: deletes.length };
    plans.push({ def, upserts, deletes });
  }

  const empty = plans.every((p) => p.upserts.length === 0 && p.deletes.length === 0);
  return { counts, next, plans, empty };
}

/**
 * Persists changes between `store` and `previous` snapshot in one transaction.
 * Throws on append-only violations or SQLite errors (with automatic transaction rollback).
 */
export function persistDiff(db: Database, store: Store, previous: Snapshot): PersistResult {
  const started = performance.now();
  const { counts, next, plans, empty } = planDiff(store, previous);
  if (empty) return { counts, snapshot: next, durationMs: performance.now() - started };

  db.exec('PRAGMA defer_foreign_keys = ON');
  db.transaction(() => {
    db.exec('PRAGMA defer_foreign_keys = ON');
    // Delete children before parents, then upsert parents before children.
    for (let i = plans.length - 1; i >= 0; i--) {
      const plan = plans[i];
      if (plan && plan.deletes.length > 0) deleteRows(db, plan.def, plan.deletes);
    }
    for (const { def, upserts } of plans) {
      if (upserts.length > 0) writeRows(db, def, upserts, !def.appendOnly);
    }
  })();

  return { counts, snapshot: next, durationMs: performance.now() - started };
}
