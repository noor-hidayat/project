#!/usr/bin/env bash
# Backup database Supabase/Postgres via pg_dump.
# Usage: SUPABASE_DB_URL="postgresql://..." ./scripts/backup.sh
set -euo pipefail

: "${SUPABASE_DB_URL:?Set SUPABASE_DB_URL (gunakan DIRECT_URL, port 5432)}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/trace-barcode}"
mkdir -p "$BACKUP_DIR"
TS=$(date +%Y%m%d-%H%M%S)
FILE="$BACKUP_DIR/trace-barcode-$TS.sql.gz"

pg_dump "$SUPABASE_DB_URL" | gzip > "$FILE"
echo "Backup tersimpan: $FILE"

# Hapus backup > 14 hari
find "$BACKUP_DIR" -name "trace-barcode-*.sql.gz" -mtime +14 -delete || true
