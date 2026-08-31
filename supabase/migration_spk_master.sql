-- Migration: SPK Master + Monitoring View (qty_kg desimal, qty_per_box, target_pcs)
-- Jalankan sekali di Supabase SQL Editor.

-- 1) Tabel master SPK (1 SPK = 1 Produk)
CREATE TABLE IF NOT EXISTS spk_master (
  id SERIAL PRIMARY KEY,
  spk TEXT UNIQUE NOT NULL,
  product_code TEXT NOT NULL REFERENCES products(code),
  product_name TEXT NOT NULL,
  qty_kg NUMERIC(10,2) NOT NULL CHECK (qty_kg > 0),
  qty_per_box INT NOT NULL CHECK (qty_per_box > 0),
  target_pcs INT NOT NULL CHECK (target_pcs > 0),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','done','over','closed')),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_spk_master_spk ON spk_master(spk);
CREATE INDEX IF NOT EXISTS idx_spk_master_product ON spk_master(product_code);
CREATE INDEX IF NOT EXISTS idx_spk_master_created_at ON spk_master(created_at);

-- Index untuk join monitoring (jika belum ada)
CREATE INDEX IF NOT EXISTS idx_scan_logs_spk ON scan_logs(spk);
CREATE INDEX IF NOT EXISTS idx_scan_logs_spk_trx ON scan_logs(spk, trx_code);

-- 2) View monitoring: 1 row per SPK, realisasi = total_box * qty_per_box
CREATE OR REPLACE VIEW spk_monitoring AS
SELECT
  m.id,
  m.spk,
  m.product_code,
  m.product_name,
  m.qty_kg,
  m.qty_per_box,
  m.target_pcs,
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

-- 3) View orphan: SPK di scan_logs yang belum ada di master
CREATE OR REPLACE VIEW spk_orphan AS
SELECT spk, COUNT(*) AS total_box, COUNT(DISTINCT trx_code) AS total_trx
FROM scan_logs
WHERE spk IS NOT NULL AND spk <> ''
  AND spk NOT IN (SELECT spk FROM spk_master)
GROUP BY spk;

-- 4) RLS / Grant (ikuti pattern schema.sql)
ALTER TABLE spk_master ENABLE ROW LEVEL SECURITY;
-- drop if exists to allow re-run
DROP POLICY IF EXISTS "public_select_spk_master" ON spk_master;
DROP POLICY IF EXISTS "public_insert_spk_master" ON spk_master;
DROP POLICY IF EXISTS "public_update_spk_master" ON spk_master;
DROP POLICY IF EXISTS "public_delete_spk_master" ON spk_master;

CREATE POLICY "public_select_spk_master" ON spk_master FOR SELECT USING (true);
CREATE POLICY "public_insert_spk_master" ON spk_master FOR INSERT WITH CHECK (true);
CREATE POLICY "public_update_spk_master" ON spk_master FOR UPDATE USING (true);
CREATE POLICY "public_delete_spk_master" ON spk_master FOR DELETE USING (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON spk_master TO anon, authenticated;
GRANT SELECT ON spk_monitoring TO anon, authenticated;
GRANT SELECT ON spk_orphan TO anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE spk_master_id_seq TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
