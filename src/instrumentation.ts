/**
 * Hook start Next.js. Dipanggil sekali per proses server sebelum request pertama.
 * Jika `DATABASE_URL` diset: jalankan migrasi, lalu hydrate store dari PostgreSQL
 * (atau seed data demo jika database masih kosong). Tanpa `DATABASE_URL` tidak ada apa-apa,
 * sehingga `next build` dan mode in-memory tetap berjalan seperti biasa.
 *
 * Import modul database hanya ada di dalam blok `NEXT_RUNTIME === 'nodejs'` agar bundle edge
 * tidak ikut menarik `pg` (yang memakai modul Node seperti `fs`).
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.DATABASE_URL) {
    const { initDatabaseStore } = await import('./server/db/bootstrap');
    const summary = await initDatabaseStore();
    const migrations =
      summary.migrationsApplied.length > 0
        ? `${summary.migrationsApplied.length} migrasi diterapkan (${summary.migrationsApplied.join(', ')})`
        : 'migrasi sudah up to date';
    const counts = Object.entries(summary.rowCounts)
      .map(([table, n]) => `${table}=${n}`)
      .join(' ');
    console.log(
      `[db] ${migrations}; store ${summary.mode === 'seeded' ? 'di-seed' : 'di-hydrate'} dari PostgreSQL ` +
        `dalam ${Math.round(summary.durationMs)} ms; baris: ${counts}`,
    );
  }
}
