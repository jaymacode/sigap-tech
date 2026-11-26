import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { isPostgres } from './config';

const globalForSqlite = globalThis as typeof globalThis & { __sigapSqlite?: Database };

/**
 * True unless `DB_PATH=memory-only` explicitly disables SQLite persistence.
 * Always true for `DB_DRIVER=postgres` (DB_PATH is ignored there).
 */
export function isDatabaseEnabled(): boolean {
  return isPostgres() || process.env.DB_PATH !== 'memory-only';
}

/** Resolves the SQLite database path and ensures its parent directory exists. */
export function getDbPath(): string {
  const path = process.env.DB_PATH || join(import.meta.dir, '..', '..', '..', 'data', 'sigap.db');
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  return path;
}

/** Opens a SQLite database with WAL, foreign keys, and busy timeout configured. */
export function openSqlite(path: string): Database {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  return db;
}

/** Returns the singleton SQLite connection (persisted on `globalThis` across HMR reloads). */
export function getSqlite(): Database {
  if (!globalForSqlite.__sigapSqlite) {
    globalForSqlite.__sigapSqlite = openSqlite(getDbPath());
  }
  return globalForSqlite.__sigapSqlite;
}

/** Closes and clears the singleton SQLite connection. */
export function closeSqlite(): void {
  if (globalForSqlite.__sigapSqlite) {
    globalForSqlite.__sigapSqlite.close();
    globalForSqlite.__sigapSqlite = undefined;
  }
}
