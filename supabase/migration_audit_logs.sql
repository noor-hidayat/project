CREATE TABLE audit_logs (
  id SERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  username TEXT,
  action TEXT NOT NULL,
  detail TEXT
);

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public_insert_audit_logs" ON audit_logs FOR INSERT WITH CHECK (true);
CREATE POLICY "public_select_audit_logs" ON audit_logs FOR SELECT USING (true);

-- Migrasi role: operator diubah menjadi admin (input barcode)
UPDATE app_users SET role = 'admin' WHERE role = 'operator';
