#!/usr/bin/env node
/**
 * Sigap Database Migration Runner
 *
 * Menerapkan file SQL di db/migrations secara berurutan (urut nama file). Semantiknya sama dengan
 * runMigrations di src/server/db/migrate.ts:
 * - tabel schema_migrations(name, applied_at) mencatat migrasi yang sudah dijalankan;
 * - seluruh proses dikunci dengan pg_advisory_lock (kunci 727001) agar dua proses tidak bermigrasi
 *   bersamaan;
 * - setiap file dijalankan dalam satu transaksi (gagal = rollback, file tidak dicatat);
 * - koneksi dicoba ulang hingga ~30 detik (container database mungkin belum siap).
 *
 * Pemakaian: DATABASE_URL=postgres://... node scripts/migrate.js
 * Exit code 0 bila semua migrasi berhasil, 1 bila gagal.
 */

const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');

/** Kunci advisory untuk migrasi. Harus sama dengan nilai di src/server/db/migrate.ts. */
const MIGRATION_LOCK_KEY = 727001;
const MIGRATIONS_DIR = path.join(__dirname, '..', 'db', 'migrations');
const CONNECT_TIMEOUT_MS = 30_000;
const RETRY_DELAY_MS = 1_000;
const LOG_PREFIX = '[sigap-migrate]';

function log(message) {
  console.log(`${LOG_PREFIX} ${message}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Membuka koneksi ke Postgres dan mencoba ulang tiap detik sampai batas waktu tercapai.
 * Password tidak pernah dicetak; hanya pesan error dari driver.
 */
async function connectWithRetry(connectionString) {
  const deadline = Date.now() + CONNECT_TIMEOUT_MS;
  let attempt = 0;
  for (;;) {
    attempt += 1;
    const client = new Client({ connectionString });
    try {
      await client.connect();
      return client;
    } catch (err) {
      await client.end().catch(() => {});
      if (Date.now() >= deadline) throw err;
      if (attempt === 1 || attempt % 5 === 0) {
        log(`Menunggu database (percobaan ${attempt}): ${err.message}`);
      }
      await sleep(RETRY_DELAY_MS);
    }
  }
}

/** Daftar file .sql di folder migrasi, diurutkan berdasarkan nama. */
function listMigrationFiles() {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.sql'))
    .sort();
}

async function runMigrationFile(client, file) {
  const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
  await client.query('BEGIN');
  try {
    await client.query(sql);
    await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw new Error(`migrasi ${file} gagal: ${err.message}`);
  }
}

/** Mengembalikan jumlah migrasi baru yang diterapkan. */
async function migrate(client, files) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  const { rows } = await client.query('SELECT name FROM schema_migrations');
  const applied = new Set(rows.map((row) => row.name));

  let count = 0;
  for (const file of files) {
    if (applied.has(file)) continue;
    log(`Menerapkan ${file}...`);
    await runMigrationFile(client, file);
    count += 1;
  }
  return count;
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error(`${LOG_PREFIX} DATABASE_URL belum diset; migrasi dibatalkan.`);
    return 1;
  }

  const files = listMigrationFiles();
  log(`Ditemukan ${files.length} file migrasi di ${MIGRATIONS_DIR}.`);

  const client = await connectWithRetry(connectionString);
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
    try {
      const count = await migrate(client, files);
      log(
        count === 0
          ? 'Tidak ada migrasi baru; skema sudah mutakhir.'
          : `${count} migrasi berhasil diterapkan.`,
      );
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]).catch(() => {});
    }
  } finally {
    await client.end().catch(() => {});
  }
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(`${LOG_PREFIX} ${err.message}`);
    process.exit(1);
  });
