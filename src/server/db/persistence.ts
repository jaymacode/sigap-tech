import type { Pool, PoolClient } from 'pg';
// Memasang parser tipe `date` (YYYY-MM-DD tetap string) untuk setiap koneksi yang dipakai modul ini.
import './pool';
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
 * Persistensi Store <-> PostgreSQL.
 *
 * - `Snapshot`: per tabel, Map pk -> nilai baris terserialisasi (JSON). Dipakai untuk diff.
 * - `persistDiff`: hanya menulis baris baru/berubah (upsert) dan menghapus baris yang hilang,
 *   dalam satu transaksi. `ticket_events` hanya INSERT (trigger DB menolak UPDATE/DELETE).
 * - Semua statement memakai parameter; jsonb di-stringify di sini (pg akan mengubah array JS
 *   menjadi array Postgres, bukan JSON).
 */

export type Snapshot = Record<TableName, Map<string, string>>;

export interface TableCount {
  upserted: number;
  deleted: number;
}

export interface PersistResult {
  counts: Record<TableName, TableCount>;
  /** Snapshot baru (sudah ter-commit); simpan sebagai snapshot berikutnya. */
  snapshot: Snapshot;
  durationMs: number;
}

const INSERT_CHUNK = 500;
const DELETE_CHUNK = 1000;
const KEY_SEP = '\u0001';

interface IndexedRow {
  row: Row;
  ser: string;
}

/**
 * JSON dengan key objek terurut. jsonb menyimpan key dalam urutan tersendiri, jadi tanpa ini
 * baris yang sama (mis. `work_hours` setelah hydrate) akan tampak berubah.
 */
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
    const indexed = indexRows(def, rows[name]);
    const map = new Map<string, string>();
    for (const [key, { ser }] of indexed) map.set(key, ser);
    snap[name] = map;
  }
  return snap;
}

/**
 * Snapshot dari keadaan Store saat ini (dipakai setelah hydrate / seed / saveAll).
 * @param store - store sumber
 */
export function takeSnapshot(store: Store): Snapshot {
  return toSnapshot(encodeStore(store));
}

/** Jumlah baris per tabel dari snapshot (untuk log dan tes). */
export function snapshotCounts(snapshot: Snapshot): Record<TableName, number> {
  const out = {} as Record<TableName, number>;
  for (const def of TABLES) out[def.name as TableName] = snapshot[def.name as TableName].size;
  return out;
}

function encodeValue(def: TableDef, column: string, value: unknown): unknown {
  if (value === undefined || value === null) return null;
  return def.jsonb.includes(column) ? JSON.stringify(value) : value;
}

/** Menulis baris: INSERT (conflict=false) atau upsert ON CONFLICT (pk) DO UPDATE (conflict=true). */
async function writeRows(
  client: PoolClient,
  def: TableDef,
  rows: Row[],
  conflict: boolean,
): Promise<void> {
  const cols = def.columns;
  const nonPk = cols.filter((c) => !def.pk.includes(c));
  let onConflict = '';
  if (conflict && nonPk.length > 0) {
    onConflict = ` ON CONFLICT (${def.pk.join(', ')}) DO UPDATE SET ${nonPk
      .map((c) => `${c} = EXCLUDED.${c}`)
      .join(', ')}`;
  }
  for (let start = 0; start < rows.length; start += INSERT_CHUNK) {
    const chunk = rows.slice(start, start + INSERT_CHUNK);
    const params: unknown[] = [];
    const tuples = chunk.map((row) => {
      const placeholders = cols.map((c) => {
        params.push(encodeValue(def, c, row[c]));
        const cast = def.jsonb.includes(c) ? '::jsonb' : '';
        return `$${params.length}${cast}`;
      });
      return `(${placeholders.join(', ')})`;
    });
    await client.query(
      `INSERT INTO ${def.name} (${cols.join(', ')}) VALUES ${tuples.join(', ')}${onConflict}`,
      params,
    );
  }
}

/** Menghapus baris berdasarkan pk (mendukung pk komposit via unnest). */
async function deleteRows(client: PoolClient, def: TableDef, keys: string[][]): Promise<void> {
  for (let start = 0; start < keys.length; start += DELETE_CHUNK) {
    const chunk = keys.slice(start, start + DELETE_CHUNK);
    const arrays = def.pk.map((_, i) => chunk.map((k) => k[i]));
    const unnestArgs = def.pk.map((_, i) => `$${i + 1}::text[]`).join(', ');
    const where = def.pk.map((c) => `t.${c} = k.${c}`).join(' AND ');
    await client.query(
      `DELETE FROM ${def.name} AS t USING unnest(${unnestArgs}) AS k(${def.pk.join(', ')}) WHERE ${where}`,
      arrays,
    );
  }
}

/**
 * Membaca seluruh tabel dalam transaksi read-only (konsisten) dan membangun Store.
 * @param client - koneksi yang sudah berada dalam transaksi
 */
export async function readStoreWith(client: PoolClient): Promise<Store> {
  const data = {} as RowsByTable;
  for (const def of TABLES) {
    const name = def.name as TableName;
    const order = def.columns.includes('ord') ? 'ord' : def.pk.join(', ');
    const res = await client.query<Row>(
      `SELECT ${def.columns.join(', ')} FROM ${def.name} ORDER BY ${order}`,
    );
    data[name] = res.rows;
  }
  return buildStore(data);
}

/**
 * Hydrate Store dari PostgreSQL (urutan Map dan array dipulihkan dari kolom `ord`).
 * @param pool - pool koneksi
 */
export async function hydrateStore(pool: Pool): Promise<Store> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const store = await readStoreWith(client);
    await client.query('COMMIT');
    return store;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Menulis seluruh Store dengan INSERT massal (chunk ≤ 500 baris) di dalam transaksi milik pemanggil.
 * Transaksi harus dibuka pemanggil karena foreign key bersifat DEFERRABLE.
 * @param client - koneksi dalam transaksi
 * @param store - store sumber
 */
export async function insertAll(client: PoolClient, store: Store): Promise<void> {
  const rows = encodeStore(store);
  for (const def of TABLES) await writeRows(client, def, rows[def.name as TableName], false);
}

/**
 * Menulis seluruh Store dalam satu transaksi (dipakai seed awal).
 * @param pool - pool koneksi
 * @param store - store sumber
 */
export async function saveAll(pool: Pool, store: Store): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await insertAll(client, store);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Menulis perubahan Store dibanding snapshot dalam satu transaksi.
 * Hanya baris baru/berubah yang di-upsert dan baris yang hilang yang dihapus.
 * Jika gagal, transaksi di-ROLLBACK dan error dilempar (pemanggil yang melakukan re-hydrate).
 * @param pool - pool koneksi
 * @param store - store saat ini
 * @param previous - snapshot keadaan tersimpan terakhir
 * @throws Error jika `ticket_events` berubah/dihapus (append-only) atau statement DB gagal
 */
export async function persistDiff(
  pool: Pool,
  store: Store,
  previous: Snapshot,
): Promise<PersistResult> {
  const started = performance.now();
  const rows = encodeStore(store);
  const counts = {} as Record<TableName, TableCount>;
  const next = {} as Snapshot;
  const plans: Array<{ def: TableDef; upserts: Row[]; deletes: string[][] }> = [];

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

  if (plans.every((p) => p.upserts.length === 0 && p.deletes.length === 0)) {
    return { counts, snapshot: next, durationMs: performance.now() - started };
  }

  const client = await pool.connect();
  let broken = false;
  try {
    await client.query('BEGIN');
    // Hapus dari anak ke induk (urutan kebalikan), lalu tulis dari induk ke anak.
    for (let i = plans.length - 1; i >= 0; i--) {
      const plan = plans[i];
      if (plan && plan.deletes.length > 0) await deleteRows(client, plan.def, plan.deletes);
    }
    for (const { def, upserts } of plans) {
      if (upserts.length > 0) await writeRows(client, def, upserts, !def.appendOnly);
    }
    await client.query('COMMIT');
  } catch (err) {
    broken = true;
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release(broken);
  }

  return { counts, snapshot: next, durationMs: performance.now() - started };
}
