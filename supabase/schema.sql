CREATE TABLE products (
  id SERIAL PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL
);

CREATE TABLE scan_logs (
  id SERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  barcode TEXT NOT NULL,
  product_code TEXT NOT NULL,
  product_name TEXT,
  barcode_date TEXT NOT NULL,
  barcode_shift TEXT NOT NULL,
  production_date TEXT NOT NULL,
  shift TEXT NOT NULL,
  serial_number TEXT NOT NULL,
  operator TEXT
);

CREATE TABLE app_users (
  id SERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL
);

ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE scan_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public_select_products" ON products FOR SELECT USING (true);
CREATE POLICY "public_select_scan_logs" ON scan_logs FOR SELECT USING (true);
CREATE POLICY "public_insert_scan_logs" ON scan_logs FOR INSERT WITH CHECK (true);
CREATE POLICY "public_select_app_users" ON app_users FOR SELECT USING (true);
CREATE POLICY "public_insert_app_users" ON app_users FOR INSERT WITH CHECK (true);
