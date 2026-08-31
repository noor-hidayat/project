-- Migration: qty_kg jadi opsional jika SPK tanpa rollsheet + flag tanpa_rollsheet
-- Jalankan di Supabase SQL Editor setelah migration_spk_master.sql

-- 1) Tambah flag tanpa_rollsheet (jika belum ada dari migration sebelumnya)
ALTER TABLE spk_master ADD COLUMN IF NOT EXISTS tanpa_rollsheet BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_spk_master_tanpa_rollsheet ON spk_master(tanpa_rollsheet);

-- 2) Jadikan qty_kg nullable, tetap >0 jika diisi
ALTER TABLE spk_master ALTER COLUMN qty_kg DROP NOT NULL;
ALTER TABLE spk_master DROP CONSTRAINT IF EXISTS spk_master_qty_kg_check;
ALTER TABLE spk_master ADD CONSTRAINT spk_master_qty_kg_check CHECK (qty_kg IS NULL OR qty_kg > 0);

-- 3) Refresh view spk_monitoring untuk expose tanpa_rollsheet (qty_kg bisa NULL)
CREATE OR REPLACE VIEW spk_monitoring AS
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
  a.last_input
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
) a ON a.spk = m.spk;

GRANT SELECT ON spk_monitoring TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
