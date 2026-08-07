-- Optimasi Riwayat Transaksi: hitung qty per transaksi di server
-- Jalankan sekali di Supabase SQL Editor.

-- 1) Index agar query scan_logs tetap cepat walau data membesar
CREATE INDEX IF NOT EXISTS idx_scan_logs_trx_code ON scan_logs (trx_code);
CREATE INDEX IF NOT EXISTS idx_scan_logs_production_date ON scan_logs (production_date);
CREATE INDEX IF NOT EXISTS idx_scan_logs_created_at ON scan_logs (created_at);

-- 2) View agregat: satu baris per transaksi + jumlah barcode
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

-- 3) Buka akses baca untuk aplikasi (anon & authenticated)
GRANT SELECT ON trx_summary TO anon, authenticated;

-- 4) Beri tahu PostgREST agar schema view segera terlihat
NOTIFY pgrst, 'reload schema';
