#!/usr/bin/env bash
# Backup database Sigap (PostgreSQL) ke file custom-format pg_dump (-Fc).
#
# Pemakaian: ./scripts/backup.sh [file-tujuan]
#   Default file: ${BACKUP_DIR:-./backups}/backup_<timestamp>.dump
#
# Dijalankan di host. Dump dibuat oleh pg_dump di dalam container service `db`
# (docker-compose.yml), sehingga tidak perlu PostgreSQL client di host.
# Skrip gagal (exit 1) bila container db tidak berjalan atau pg_dump gagal; tidak ada placeholder.
set -euo pipefail

DB_SERVICE="${SIGAP_DB_SERVICE:-db}"
DB_USER="${POSTGRES_USER:-postgres}"
DB_NAME="${POSTGRES_DB:-sigap}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
FILE="${1:-${BACKUP_DIR}/backup_${TIMESTAMP}.dump}"

if [ -z "$(docker compose ps -q "$DB_SERVICE" --status running 2>/dev/null)" ]; then
  echo "[sigap-backup] Error: container '$DB_SERVICE' tidak berjalan. Jalankan: docker compose up -d db" >&2
  exit 1
fi

mkdir -p "$(dirname "$FILE")"
echo "[sigap-backup] Membuat backup database '${DB_NAME}' ke ${FILE}..."

# Tulis ke file sementara lalu pindahkan, agar dump yang gagal tidak tampak sebagai backup valid.
TMP_FILE="${FILE}.partial"
if ! docker compose exec -T "$DB_SERVICE" \
  pg_dump -U "$DB_USER" -Fc -d "$DB_NAME" > "$TMP_FILE"; then
  rm -f "$TMP_FILE"
  echo "[sigap-backup] Error: pg_dump gagal." >&2
  exit 1
fi
mv "$TMP_FILE" "$FILE"

SIZE="$(wc -c < "$FILE" | tr -d ' ')"
echo "[sigap-backup] Backup selesai: ${FILE} (${SIZE} byte)."
echo "[sigap-backup] Pulihkan dengan: ./scripts/restore.sh ${FILE}"
