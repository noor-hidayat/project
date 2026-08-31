-- Hotfix: pastikan view spk_monitoring dedup rollsheet 1x per batch (fix x2 seperti SPK 2PM2-26.08.1453/VCM)
-- Jalankan ini di Supabase SQL Editor JIKA migration_add_batch_to_scan_logs.sql sudah pernah dijalankan tapi kg masih x2.
-- Penyebab x2 umum: (1) view lama masih versi per-trx_code, (2) batch_code sama tapi beda case/spasi -> dianggap 2 batch, (3) data lama tanpa batch_code tetap hitung per-trx.

-- 1) Normalisasi batch_code yang sudah terlanjur tersimpan (trim + uppercase)
UPDATE scan_logs SET batch_code = UPPER(TRIM(batch_code)) WHERE batch_code IS NOT NULL AND TRIM(batch_code) <> '' AND batch_code <> UPPER(TRIM(batch_code));

-- 2) Rebuild view spk_monitoring dengan dedup normalized (sama seperti migration_add_batch_to_scan_logs.sql yang sudah di-patch)
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
    SELECT spk, UPPER(TRIM(batch_code)) AS batch_norm, MAX(rollsheet_kg) AS batch_kg
    FROM scan_logs
    WHERE spk IS NOT NULL AND spk <> '' AND batch_code IS NOT NULL AND TRIM(batch_code) <> ''
    GROUP BY spk, UPPER(TRIM(batch_code))
    UNION ALL
    SELECT spk, trx_code AS batch_norm, MAX(rollsheet_kg) AS batch_kg
    FROM scan_logs
    WHERE spk IS NOT NULL AND spk <> '' AND (batch_code IS NULL OR TRIM(batch_code) = '') AND rollsheet_kg IS NOT NULL
    GROUP BY spk, trx_code
  ) t
  GROUP BY spk
) r ON r.spk = m.spk;

GRANT SELECT ON spk_monitoring TO anon, authenticated;
NOTIFY pgrst, 'reload schema';

-- 3) DIAGNOSA SPK 2PM2-26.08.1453/VCM — jalankan SELECT di bawah untuk cek kenapa x2:
-- SELECT spk, trx_code, batch_code, UPPER(TRIM(batch_code)) AS batch_norm, rollsheet_kg, COUNT(*) AS rows_per_trx FROM scan_logs WHERE spk='2PM2-26.08.1453/VCM' GROUP BY spk, trx_code, batch_code, rollsheet_kg ORDER BY trx_code;
-- SELECT * FROM spk_monitoring WHERE spk='2PM2-26.08.1453/VCM';
-- SELECT spk, UPPER(TRIM(batch_code)) AS batch_norm, MAX(rollsheet_kg) AS kg, COUNT(*) AS trx_pakai_batch FROM scan_logs WHERE spk='2PM2-26.08.1453/VCM' AND TRIM(coalesce(batch_code,''))<>'' GROUP BY spk, UPPER(TRIM(batch_code));
-- SELECT spk, trx_code, MAX(rollsheet_kg) AS kg FROM scan_logs WHERE spk='2PM2-26.08.1453/VCM' AND (batch_code IS NULL OR TRIM(batch_code)='') GROUP BY spk, trx_code;

-- 4) Jika hasil diagnosa menunjukkan 1 batch dipakai 2 trx tapi batch_code berbeda string (misal "1RS-6GUMP3-91-01" vs "1RS-6GUMP3-91-01 " atau vs "1RS-6GUMP3-91-02"),
--    gabungkan manual: UPDATE scan_logs SET batch_code = '1RS-6GUMP3-91-01' WHERE spk='2PM2-26.08.1453/VCM' AND UPPER(TRIM(batch_code)) IN ('...','...');
