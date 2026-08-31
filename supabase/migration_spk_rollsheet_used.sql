-- Migration: monitoring rollsheet terpakai per SPK (SUM distinct per trx_code)
-- Jalankan di Supabase SQL Editor setelah migration_scan_logs_rollsheet_kg.sql

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
  COALESCE(a.total_rollsheet_used, 0) AS total_rollsheet_used,
  CASE WHEN m.qty_kg IS NOT NULL THEN m.qty_kg - COALESCE(a.total_rollsheet_used, 0) ELSE NULL END AS sisa_kg,
  CASE WHEN m.qty_kg IS NOT NULL AND m.qty_kg > 0 THEN ROUND(COALESCE(a.total_rollsheet_used,0)::numeric / m.qty_kg * 100, 1) ELSE NULL END AS rollsheet_progress_pct
FROM spk_master m
LEFT JOIN (
  SELECT
    spk,
    COUNT(*) AS total_box,
    COUNT(DISTINCT trx_code) AS total_trx,
    MIN(production_date) AS first_date,
    MAX(production_date) AS last_date,
    MAX(created_at) AS last_input,
    COALESCE(SUM(trx_kg), 0) AS total_rollsheet_used
  FROM (
    SELECT spk, trx_code, MAX(rollsheet_kg) AS trx_kg
    FROM scan_logs
    WHERE spk IS NOT NULL AND spk <> ''
    GROUP BY spk, trx_code
  ) t
  GROUP BY spk
) a ON a.spk = m.spk;

GRANT SELECT ON spk_monitoring TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
