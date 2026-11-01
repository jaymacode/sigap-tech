#!/usr/bin/env bash
# Pulihkan database Sigap dari file backup custom-format (dibuat scripts/backup.sh).
#
# Pemakaian: ./scripts/restore.sh <file.dump>
#
# PERHATIAN: restore menimpa semua tabel di database `sigap` (pg_restore --clean --if-exists).
# Setelah restore, web me-load ulang state dari database; skrip ini memintanya restart web.
set -euo pipefail

FILE="${1:-}"
if [ -z "$FILE" ]; then
  echo "Error: Path file backup wajib disertakan. Contoh: ./scripts/restore.sh ./backups/backup_xxxx.dump" >&2
  exit 1
fi

if [ ! -f "$FILE" ]; then
  echo "Error: File backup '$FILE' tidak ditemukan." >&2
  exit 1
fi

DB_SERVICE="${SIGAP_DB_SERVICE:-db}"
DB_USER="${POSTGRES_USER:-postgres}"
DB_NAME="${POSTGRES_DB:-sigap}"

if [ -z "$(docker compose ps -q "$DB_SERVICE" --status running 2>/dev/null)" ]; then
  echo "[sigap-restore] Error: container '$DB_SERVICE' tidak berjalan. Jalankan: docker compose up -d db" >&2
  exit 1
fi

echo "[sigap-restore] Memulihkan database '${DB_NAME}' dari ${FILE}..."
if ! docker compose exec -T "$DB_SERVICE" \
  pg_restore -U "$DB_USER" -d "$DB_NAME" --clean --if-exists --no-owner < "$FILE"; then
  # pg_restore mengembalikan exit code 1 bila ada peringatan non-fatal (mis. objek yang tidak ada saat --clean).
  echo "[sigap-restore] pg_restore selesai dengan peringatan atau error; periksa output di atas." >&2
  echo "[sigap-restore] Bila hanya peringatan (mis. objek belum ada saat --clean), data mungkin sudah pulih; periksa dengan make psql." >&2
  exit 1
fi

echo "[sigap-restore] Restore selesai. Jalankan ulang web agar memuat data terbaru:"
echo "[sigap-restore]   docker compose restart web"
