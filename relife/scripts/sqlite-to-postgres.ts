/**
 * One-off cut-over: copies an existing SQLite database into an EMPTY PostgreSQL database.
 *
 *   DATABASE_URL=postgres://user:pass@host:5432/sigap bun scripts/sqlite-to-postgres.ts C:/backup/sigap-copy.db
 *
 * - Reads the SQLite file read-only (use a copy taken while the app is stopped).
 * - Applies db/postgres/*.sql migrations, refuses to run if Postgres already has users/tickets.
 * - Writes everything in one transaction, then re-reads Postgres and compares row-by-row.
 */
import { Database } from 'bun:sqlite';
import { SQL } from 'bun';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { readStoreWith, takeSnapshot } from '@/server/db/persistence';
import {
  hydrateStorePg,
  insertAllPg,
  isEmptyPg,
  lockPg,
  runPgMigrations,
} from '@/server/db/postgres';
import { TABLE_NAMES } from '@/server/db/tables';

const sqlitePath = process.argv[2];
const url = process.env.DATABASE_URL;
if (!sqlitePath || !url) {
  console.error('Pakai: DATABASE_URL=postgres://... bun scripts/sqlite-to-postgres.ts <file.db>');
  process.exit(1);
}

const lite = new Database(sqlitePath, { readonly: true });
const expected = readdirSync(join(import.meta.dir, '..', 'db')).filter((f) => f.endsWith('.sql'));
const applied = new Set(
  (lite.query('SELECT id FROM schema_migrations').all() as Array<{ id: string }>).map((r) => r.id),
);
const missing = expected.filter((f) => !applied.has(f));
if (missing.length > 0) {
  console.error(
    `SQLite belum dimigrasi (${missing.join(', ')}). Jalankan aplikasi sekali dengan DB_PATH=<salinan> lalu ulangi.`,
  );
  process.exit(1);
}

const store = lite.transaction(() => readStoreWith(lite))();
lite.close();
const source = takeSnapshot(store);

const pg = new SQL(url);
try {
  const migrations = await runPgMigrations(pg);
  console.log(`[pg] migrasi diterapkan: ${migrations.join(', ') || '(sudah terbaru)'}`);

  await pg.begin(async (tx) => {
    await lockPg(tx);
    if (!(await isEmptyPg(tx))) throw new Error('PostgreSQL tidak kosong (users/tickets sudah ada)');
    await insertAllPg(tx, store);
  });

  const copied = takeSnapshot(await hydrateStorePg(pg));
  let ok = true;
  for (const table of TABLE_NAMES) {
    const a = source[table];
    const b = copied[table];
    const same = a.size === b.size && [...a].every(([k, v]) => b.get(k) === v);
    if (!same) ok = false;
    console.log(`${same ? 'OK  ' : 'BEDA'} ${table.padEnd(14)} ${a.size} -> ${b.size}`);
  }
  if (!ok) throw new Error('Verifikasi gagal: isi PostgreSQL berbeda dari SQLite');
  console.log('Selesai. Set DB_DRIVER=postgres dan DATABASE_URL, lalu jalankan aplikasi.');
} catch (err) {
  console.error(err);
  process.exitCode = 1;
} finally {
  await pg.close();
}
