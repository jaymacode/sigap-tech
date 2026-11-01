import { expect } from 'vitest';
import { Pool } from 'pg';
import { seedStore } from '@/server/mock/seed';
import { createEmptyStore, type Store } from '@/server/mock/store';

/** Database uji. Tes DB hanya berjalan jika variabel ini diset. */
export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

/** Waktu seed tetap agar tes deterministik (Rabu 21 Okt 2026 10:00 WIB). */
export const NOW = new Date('2026-10-21T10:00:00+07:00');

/**
 * Membuat database uji (`sigap_test`) jika belum ada. Terhubung ke database `postgres`.
 * @param url - TEST_DATABASE_URL
 */
export async function ensureTestDatabase(url: string): Promise<void> {
  const target = new URL(url);
  const dbName = decodeURIComponent(target.pathname.slice(1));
  target.pathname = '/postgres';
  const admin = new Pool({ connectionString: target.toString(), max: 1 });
  try {
    const found = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
    if (found.rowCount === 0) await admin.query(`CREATE DATABASE "${dbName}"`);
  } finally {
    await admin.end();
  }
}

/** Mengosongkan schema public (setiap suite mulai dari schema bersih). */
export async function resetSchema(pool: Pool): Promise<void> {
  await pool.query('DROP SCHEMA IF EXISTS public CASCADE');
  await pool.query('CREATE SCHEMA public');
}

/** Store seed in-memory (tanpa database). */
export function seededStore(now: Date = NOW): Store {
  const store = createEmptyStore(now);
  seedStore(store, now);
  return store;
}

/** Store tanpa cache kalender (cache bukan bagian dari data persisten). */
export function withoutCache(store: Store): Store {
  return { ...store, calendarCache: new Map() };
}

/**
 * Membandingkan dua store: isi secara deep (termasuk undefined vs null) dan urutan key setiap Map.
 * @param actual - hasil hydrate
 * @param expected - store sumber
 */
export function expectSameStore(actual: Store, expected: Store): void {
  const mapKeys = [
    'users',
    'teams',
    'categories',
    'catalog',
    'calendars',
    'policies',
    'tickets',
    'ticketIdByNumber',
    'sla',
    'events',
    'comments',
    'attachments',
    'csat',
  ] as const;
  for (const key of mapKeys) {
    expect([...actual[key].keys()], `urutan key Map ${key}`).toEqual([...expected[key].keys()]);
  }
  expect(withoutCache(actual)).toStrictEqual(withoutCache(expected));
}
