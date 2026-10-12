#!/usr/bin/env bash
# Restore database dari file backup .sql.gz
# Usage: ./scripts/restore.sh /var/backups/trace-barcode/trace-barcode-YYYYMMDD-HHMMSS.sql.gz
set -euo pipefail

: "${SUPABASE_DB_URL:?Set SUPABASE_DB_URL (gunakan DIRECT_URL, port 5432)}"
FILE="${1:?Isi path file backup}"
gunzip -c "$FILE" | psql "$SUPABASE_DB_URL"
echo "Restore selesai dari $FILE"
