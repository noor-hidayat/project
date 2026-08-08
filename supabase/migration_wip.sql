-- Migration: tabel wip_logs untuk pencatatan Work In Progress
-- Jalankan sekali di Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS wip_logs (
  id SERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  product_name TEXT NOT NULL,
  batch TEXT NOT NULL,
  spk TEXT NOT NULL,
  qty INTEGER NOT NULL DEFAULT 1,
  operator TEXT,
  production_date TEXT,
  shift TEXT,
  admin_user TEXT
);

CREATE INDEX IF NOT EXISTS idx_wip_logs_spk ON wip_logs (spk);
CREATE INDEX IF NOT EXISTS idx_wip_logs_batch ON wip_logs (batch);

ALTER TABLE wip_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public_select_wip_logs" ON wip_logs;
CREATE POLICY "public_select_wip_logs" ON wip_logs FOR SELECT USING (true);

DROP POLICY IF EXISTS "public_insert_wip_logs" ON wip_logs;
CREATE POLICY "public_insert_wip_logs" ON wip_logs FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "public_delete_wip_logs" ON wip_logs;
CREATE POLICY "public_delete_wip_logs" ON wip_logs FOR DELETE USING (true);

GRANT SELECT, INSERT, DELETE ON wip_logs TO anon, authenticated;
GRANT USAGE ON SEQUENCE wip_logs_id_seq TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
