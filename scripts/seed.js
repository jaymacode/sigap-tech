#!/usr/bin/env node
/**
 * Sigap Seed Helper
 *
 * Data demo TIDAK ditulis oleh skrip ini. Seeding dilakukan oleh proses web saat boot: bila tabel
 * tickets/users masih kosong, initDatabaseStore (src/server/db/bootstrap.ts) membangun data demo
 * deterministik di memori lalu menyimpannya ke Postgres dalam satu transaksi, dilindungi advisory
 * lock 727002 agar tidak pernah ter-seed dua kali.
 *
 * Penggunaan:
 *   node scripts/seed.js --if-empty   Hanya melaporkan apakah database sudah berisi data (exit 0).
 *   node scripts/seed.js              Menampilkan penjelasan; tidak mengubah database (exit 0).
 */

const { Client } = require('pg');

const LOG_PREFIX = '[sigap-seed]';
const ifEmpty = process.argv.includes('--if-empty');

function log(message) {
  console.log(`${LOG_PREFIX} ${message}`);
}

async function reportTickets(connectionString) {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const { rows: tableRows } = await client.query(
      "SELECT to_regclass('public.tickets') IS NOT NULL AS exists",
    );
    if (!tableRows[0].exists) {
      log(
        'Tabel tickets belum ada (migrasi belum dijalankan). Web akan mengisi data demo saat boot.',
      );
      return;
    }
    const { rows } = await client.query('SELECT count(*)::int AS total FROM tickets');
    const total = rows[0].total;
    if (total === 0) {
      log('Database kosong. Container web akan mengisi data demo pada boot pertama.');
    } else {
      log(`Database sudah berisi ${total} tiket. Seed tidak diperlukan.`);
    }
  } finally {
    await client.end().catch(() => {});
  }
}

async function main() {
  if (!ifEmpty) {
    log(
      'Tidak ada perubahan yang dilakukan. Seeding dijalankan otomatis oleh container web saat boot,',
    );
    log('dan hanya bila database kosong. Gunakan --if-empty untuk memeriksa status data.');
    return 0;
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    log('DATABASE_URL belum diset; tidak ada database yang diperiksa.');
    return 0;
  }

  await reportTickets(connectionString);
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(`${LOG_PREFIX} Gagal memeriksa database: ${err.message}`);
    process.exit(1);
  });
