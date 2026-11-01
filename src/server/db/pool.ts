import { Pool, types } from 'pg';

/**
 * Koneksi PostgreSQL (sistem of record). Singleton di `globalThis` agar bertahan saat HMR dev.
 * Tanpa `DATABASE_URL` aplikasi berjalan murni in-memory (unit test, `next build`).
 */

// Kolom `date` tetap berupa string `YYYY-MM-DD` (tidak dikonversi ke Date zona lokal).
types.setTypeParser(1082, (value) => value);

const globalForPool = globalThis as typeof globalThis & { __sigapPool?: Pool };

/** True jika `DATABASE_URL` diset, berarti store dibaca/ditulis ke PostgreSQL. */
export function isDatabaseEnabled(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

/**
 * Mengembalikan pool koneksi (dibuat sekali per proses).
 * @throws Error jika `DATABASE_URL` belum diset
 */
export function getPool(): Pool {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL belum diset');
  if (!globalForPool.__sigapPool) {
    globalForPool.__sigapPool = new Pool({ connectionString: url, max: 10 });
  }
  return globalForPool.__sigapPool;
}
