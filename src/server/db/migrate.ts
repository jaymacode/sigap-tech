import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Pool } from 'pg';

/** Kunci advisory lock untuk migrasi (dipakai juga oleh scripts/migrate.js). */
export const MIGRATION_LOCK_KEY = 727001;

/** Direktori SQL migrasi: `<cwd>/db/migrations` (dev dan image Docker menyalin `db/` ke `/app/db`). */
export function migrationsDir(): string {
  return join(process.cwd(), 'db', 'migrations');
}

/**
 * Menjalankan migrasi `db/migrations/*.sql` yang belum tercatat, berurutan nama file.
 * Dijalankan di bawah `pg_advisory_lock` sehingga dua proses tidak migrasi bersamaan.
 * @param pool - pool koneksi
 * @returns nama file yang baru diterapkan (kosong jika sudah up to date)
 */
export async function runMigrations(pool: Pool): Promise<string[]> {
  const files = readdirSync(migrationsDir())
    .filter((f) => f.endsWith('.sql'))
    .sort();
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name       text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`);
    const done = await client.query<{ name: string }>('SELECT name FROM schema_migrations');
    const seen = new Set(done.rows.map((r) => r.name));
    for (const file of files) {
      if (seen.has(file)) continue;
      const sql = readFileSync(join(migrationsDir(), file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
      applied.push(file);
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]).catch(() => {});
    client.release();
  }
  return applied;
}
