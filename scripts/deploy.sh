#!/usr/bin/env bash
set -euo pipefail

TARGET_VERSION="${1:-}"
if [ -z "$TARGET_VERSION" ]; then
  echo "Penggunaan: ./scripts/deploy.sh <target-version> (contoh: ./scripts/deploy.sh v1.0.0)"
  exit 1
fi

LOG_DIR="./deploy-logs"
mkdir -p "$LOG_DIR"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
LOG_FILE="${LOG_DIR}/deploy_${TIMESTAMP}.log"
exec > >(tee -a "$LOG_FILE") 2>&1

START_TIME=$(date +%s)
WEB_URL="${SIGAP_WEB_URL:-http://localhost:3000}"
CHANGE_TOKEN="${CHANGE_WEBHOOK_TOKEN:-local-change-token}"

echo "=========================================================="
echo " Sigap Automated Deployment Process: ${TARGET_VERSION}"
echo " Waktu: $(date)"
echo " Log: ${LOG_FILE}"
echo "=========================================================="

# 1. Pre-check: periksa status health saat ini
CURRENT_VERSION="unknown"
echo "[1/8] Memeriksa status kesehatan aplikasi saat ini..."
if curl -sf "${WEB_URL}/api/health" > /tmp/sigap_health.json 2>/dev/null; then
  CURRENT_VERSION=$(grep -o '"version":"[^"]*' /tmp/sigap_health.json | cut -d'"' -f4 || echo "unknown")
  echo "Aplikasi berjalan aktif. Versi saat ini: ${CURRENT_VERSION}"
else
  echo "Aplikasi belum aktif atau tidak merespons di ${WEB_URL}, melanjutkan deployment baru..."
fi

# 2. Register Change di Sigap
echo "[2/8] Mendaftarkan Change Request di Sigap ITSM..."
CHG_NUMBER="CHG-DEPLOY"
CHG_ID=""
CHANGE_PAYLOAD=$(cat <<EOF
{
  "type": "standard",
  "title": "Deploy release ${TARGET_VERSION} to local environment",
  "source": "pipeline",
  "commitSha": "$(git rev-parse --short HEAD 2>/dev/null || echo 'local')",
  "environment": "production-local",
  "fromVersion": "${CURRENT_VERSION}",
  "toVersion": "${TARGET_VERSION}"
}
EOF
)

if REGISTER_RESP=$(curl -sf -X POST "${WEB_URL}/api/changes" \
  -H "Authorization: Bearer ${CHANGE_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "$CHANGE_PAYLOAD" 2>/dev/null); then
  CHG_NUMBER=$(echo "$REGISTER_RESP" | grep -o '"number":"[^"]*' | cut -d'"' -f4 || echo "CHG-DEPLOY")
  CHG_ID=$(echo "$REGISTER_RESP" | grep -o '"id":"[^"]*' | cut -d'"' -f4 || echo "")
  echo "Change terdaftar: ${CHG_NUMBER}"
else
  echo "Peringatan: Tidak dapat mendaftarkan Change via API (aplikasi mungkin belum up)."
fi

rollback_deployment() {
  echo "=========================================================="
  echo " [ROLLBACK] Terjadi kegagalan saat deploy ${TARGET_VERSION}!"
  echo " Mengembalikan stack ke versi sebelumnya: ${CURRENT_VERSION}"
  echo "=========================================================="
  
  if [ -n "$CHG_ID" ]; then
    curl -sf -X PATCH "${WEB_URL}/api/changes/${CHG_ID}" \
      -H "Authorization: Bearer ${CHANGE_TOKEN}" \
      -H "Content-Type: application/json" \
      -d '{"status":"rolled_back","notes":"Deployment verification failed"}' > /dev/null 2>&1 || true
  fi

  if [ -f "/tmp/sigap_backup_${TIMESTAMP}.dump" ]; then
    ./scripts/restore.sh "/tmp/sigap_backup_${TIMESTAMP}.dump" || true
  fi

  SIGAP_VERSION="${CURRENT_VERSION}" docker compose up -d web worker
  exit 1
}

# 3. Backup sebelum deploy
echo "[3/8] Membuat snapshot cadangan sebelum deploy..."
mkdir -p ./backups
BACKUP_FILE="./backups/pre-${TARGET_VERSION}-${TIMESTAMP}.dump"
./scripts/backup.sh "$BACKUP_FILE"
cp "$BACKUP_FILE" "/tmp/sigap_backup_${TIMESTAMP}.dump" 2>/dev/null || true

# 4. Pull / Build Image
echo "[4/8] Menyiapkan image Docker..."
if docker pull "ghcr.io/antigravity/sigap:${TARGET_VERSION}" 2>/dev/null; then
  echo "Image ditarik dari registry."
else
  echo "Registry offline atau image tidak ditemukan, membangun image lokal..."
  APP_VERSION="${TARGET_VERSION}" docker compose build web worker
fi

# 5. Migrate
echo "[5/8] Menjalankan migrasi database..."
docker compose run --rm migrate || rollback_deployment

# 6. Swap Containers
echo "[6/8] Memperbarui container web & worker ke versi ${TARGET_VERSION}..."
SIGAP_VERSION="${TARGET_VERSION}" docker compose up -d web worker

# 7. Verify Healthcheck
echo "[7/8] Verifikasi kesehatan layanan..."
VERIFIED=0
for i in {1..30}; do
  if curl -sf "${WEB_URL}/api/health" > /dev/null 2>&1; then
    VERIFIED=1
    break
  fi
  sleep 2
done

if [ "$VERIFIED" -ne 1 ]; then
  echo "Healthcheck timeout setelah 60 detik!"
  rollback_deployment
fi

# 8. Mark Change Succeeded
echo "[8/8] Memperbarui status Change menjadi succeeded..."
if [ -n "$CHG_ID" ]; then
  curl -sf -X PATCH "${WEB_URL}/api/changes/${CHG_ID}" \
    -H "Authorization: Bearer ${CHANGE_TOKEN}" \
    -H "Content-Type: application/json" \
    -d '{"status":"succeeded"}' > /dev/null 2>&1 || true
fi

END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))

echo "=========================================================="
echo " Deploy Berhasil!"
echo " Versi: ${TARGET_VERSION}"
echo " Nomor Change: ${CHG_NUMBER}"
echo " Durasi: ${DURATION}s"
echo " Web UI: ${WEB_URL}"
echo "=========================================================="

