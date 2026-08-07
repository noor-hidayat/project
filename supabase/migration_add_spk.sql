-- Migration: tambah kolom spk di scan_logs untuk nomor Surat Perintah Kerja

ALTER TABLE scan_logs ADD COLUMN IF NOT EXISTS spk TEXT;

-- Drop dulu jika view lama ada, karena CREATE OR REPLACE tidak bisa
-- mengubah nama kolom view yang sudah terlanjur ada (error 42P16).
DROP VIEW IF EXISTS trx_summary;

-- Tampilkan spk di view agregat riwayat transaksi
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
  COUNT(*)             AS qty
FROM scan_logs
WHERE trx_code IS NOT NULL
GROUP BY trx_code;

GRANT SELECT ON trx_summary TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
