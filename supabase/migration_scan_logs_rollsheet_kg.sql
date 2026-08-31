/* Migration: tambah kolom rollsheet_kg di scan_logs untuk mencatat kg rollsheet yang dipakai per transaksi
   Jalankan di Supabase SQL Editor setelah migration_spk_* */

ALTER TABLE scan_logs ADD COLUMN IF NOT EXISTS rollsheet_kg NUMERIC(10,2) CHECK (rollsheet_kg IS NULL OR rollsheet_kg > 0);

/* Index opsional untuk laporan */
CREATE INDEX IF NOT EXISTS idx_scan_logs_rollsheet_spk ON scan_logs(spk, rollsheet_kg);

/* Update view trx_summary agar bawa rollsheet info juga (opsional, untuk history) */
DROP VIEW IF EXISTS trx_summary;
CREATE OR REPLACE VIEW trx_summary AS
SELECT
  trx_code,
  MAX(product_name)    AS product_name,
  MAX(product_code)    AS product_code,
  MAX(production_date) AS production_date,
  MAX(shift)           AS shift,
  MAX(operator)        AS operator,
  MAX(spk)             AS spk,
  MAX(admin_user)      AS admin_user,
  MAX(created_at)      AS created_at,
  MAX(rollsheet_kg)    AS rollsheet_kg,
  COUNT(*)             AS qty
FROM scan_logs
WHERE trx_code IS NOT NULL
GROUP BY trx_code;

GRANT SELECT ON trx_summary TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
