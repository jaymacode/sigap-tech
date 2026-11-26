export type DbDriver = 'sqlite' | 'postgres';

/** `DB_DRIVER=sqlite|postgres` (default `sqlite`). Unknown values fail loudly at boot. */
export function getDbDriver(): DbDriver {
  const raw = (process.env.DB_DRIVER || 'sqlite').trim().toLowerCase();
  if (raw === 'sqlite' || raw === 'postgres') return raw;
  throw new Error(`DB_DRIVER tidak dikenal: "${raw}" (pilih sqlite atau postgres)`);
}

export function isPostgres(): boolean {
  return getDbDriver() === 'postgres';
}
