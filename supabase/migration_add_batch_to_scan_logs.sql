/* Migration: tambah batch_code di scan_logs + dedup hitung rollsheet per batch (1 batch dipakai N trx tetap hitung 1x per SPK)
   Jalankan di Supabase SQL Editor setelah migration_scan_logs_rollsheet_kg.sql */

ALTER TABLE scan_logs ADD COLUMN IF NOT EXISTS batch_code TEXT;
CREATE INDEX IF NOT EXISTS idx_scan_logs_batch ON scan_logs(batch_code);
CREATE INDEX IF NOT EXISTS idx_scan_logs_spk_batch ON scan_logs(spk, batch_code);

/* Rebuild trx_summary agar bawa batch_code */
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
  MAX(batch_code)      AS batch_code,
  COUNT(*)             AS qty
FROM scan_logs
WHERE trx_code IS NOT NULL
GROUP BY trx_code;

GRANT SELECT ON trx_summary TO anon, authenticated;

/* Rebuild spk_monitoring: dedup per batch_code (1 batch hitung 1x per SPK) */
DROP VIEW IF EXISTS spk_monitoring;
CREATE VIEW spk_monitoring AS
SELECT
  m.id,
  m.spk,
  m.product_code,
  m.product_name,
  m.qty_kg,
  m.qty_per_box,
  m.target_pcs,
  m.tanpa_rollsheet,
  m.status AS master_status,
  m.notes,
  m.created_at,
  m.created_by,
  COALESCE(a.total_box, 0) AS total_box,
  COALESCE(a.total_box, 0) * m.qty_per_box AS realisasi_pcs,
  COALESCE(a.total_trx, 0) AS total_trx,
  (m.target_pcs - COALESCE(a.total_box, 0) * m.qty_per_box) AS selisih_pcs,
  CASE WHEN m.target_pcs > 0 THEN ROUND(COALESCE(a.total_box,0) * m.qty_per_box::numeric / m.target_pcs * 100, 1) ELSE 0 END AS progress_pct,
  CASE WHEN m.status = 'closed' THEN 'closed'
       WHEN COALESCE(a.total_box,0) * m.qty_per_box > m.target_pcs THEN 'over'
       WHEN COALESCE(a.total_box,0) * m.qty_per_box = m.target_pcs THEN 'done'
       ELSE 'open' END AS calc_status,
  a.first_date,
  a.last_date,
  a.last_input,
  COALESCE(r.total_rollsheet_used, 0) AS total_rollsheet_used,
  CASE WHEN m.qty_kg IS NOT NULL THEN m.qty_kg - COALESCE(r.total_rollsheet_used, 0) ELSE NULL END AS sisa_kg,
  CASE WHEN m.qty_kg IS NOT NULL AND m.qty_kg > 0 THEN ROUND(COALESCE(r.total_rollsheet_used,0)::numeric / m.qty_kg * 100, 1) ELSE NULL END AS rollsheet_progress_pct
FROM spk_master m
LEFT JOIN (
  SELECT
    spk,
    COUNT(*) AS total_box,
    COUNT(DISTINCT trx_code) AS total_trx,
    MIN(production_date) AS first_date,
    MAX(production_date) AS last_date,
    MAX(created_at) AS last_input
  FROM scan_logs
  WHERE spk IS NOT NULL AND spk <> ''
  GROUP BY spk
) a ON a.spk = m.spk
LEFT JOIN (
  SELECT spk, COALESCE(SUM(batch_kg), 0) AS total_rollsheet_used
  FROM (
    -- batch ada batch_code: hitung 1x per batch_code per SPK (dedup)
    SELECT spk, batch_code, MAX(rollsheet_kg) AS batch_kg
    FROM scan_logs
    WHERE spk IS NOT NULL AND spk <> '' AND batch_code IS NOT NULL AND batch_code <> ''
    GROUP BY spk, batch_code
    UNION ALL
    -- fallback data lama tanpa batch_code: hitung per trx_code
    SELECT spk, trx_code AS batch_code, MAX(rollsheet_kg) AS batch_kg
    FROM scan_logs
    WHERE spk IS NOT NULL AND spk <> '' AND (batch_code IS NULL OR batch_code = '') AND rollsheet_kg IS NOT NULL
    GROUP BY spk, trx_code
  ) t
  GROUP BY spk
) r ON r.spk = m.spk;

GRANT SELECT ON spk_monitoring TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
