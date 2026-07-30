-- Jalankan di Supabase SQL Editor
-- Migration: pindah data transactions ke scan_logs, drop transactions & transaction_id

-- 1. Tambah kolom di scan_logs
ALTER TABLE scan_logs ADD COLUMN IF NOT EXISTS admin_user TEXT;
ALTER TABLE scan_logs ADD COLUMN IF NOT EXISTS trx_code TEXT;

-- 2. Backfill data dari transactions ke scan_logs
UPDATE scan_logs sl
SET
  admin_user = t.admin_user,
  trx_code   = t.trx_code
FROM transactions t
WHERE sl.transaction_id = t.transaction_id;

-- 3. Generate trx_code buat data yg masih NULL
UPDATE scan_logs
SET trx_code = CONCAT(
  'TRX-',
  TO_CHAR(production_date::date, 'DDMMYY'),
  '-',
  LPAD(CAST(EXTRACT(EPOCH FROM created_at) * 1000 AS BIGINT) % 100000::TEXT, 5, '0')
)
WHERE trx_code IS NULL;

-- 4. Lepas FK
ALTER TABLE scan_logs DROP CONSTRAINT IF EXISTS fk_scan_logs_transaction;

-- 5. Drop index & kolom transaction_id
DROP INDEX IF EXISTS idx_scan_logs_transaction_id;
ALTER TABLE scan_logs DROP COLUMN IF EXISTS transaction_id;

-- 6. Drop transactions table & policies
DROP TABLE IF EXISTS transactions;
