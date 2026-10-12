-- Migrasi ID cuid (text) → integer berurutan, TANPA menghapus data.
-- Strategi: tabel baru *_new + kolom old_id sementara untuk remap FK,
-- lalu DROP tabel lama CASCADE + RENAME. Dijalankan dalam 1 transaksi.
-- Counter harian (pallet_counters) diganti counter bulanan untuk format PLT/yymm/nnnn.

BEGIN;

-- ── 1. Users ─────────────────────────────────────────────────────────────
CREATE TABLE trace.users_new (
  id SERIAL PRIMARY KEY, old_id TEXT,
  name TEXT NOT NULL, username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role trace."Role" NOT NULL DEFAULT 'PRODUCTION'::trace."Role",
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO trace.users_new (old_id, name, username, password_hash, role, is_active, created_at, updated_at)
  SELECT id, name, username, password_hash, role, is_active, created_at, updated_at
  FROM trace.users ORDER BY created_at, id;

-- ── 2. Products ──────────────────────────────────────────────────────────
CREATE TABLE trace.products_new (
  id SERIAL PRIMARY KEY, old_id TEXT,
  product_code TEXT NOT NULL UNIQUE, product_name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO trace.products_new (old_id, product_code, product_name, is_active, created_at, updated_at)
  SELECT id, product_code, product_name, is_active, created_at, updated_at
  FROM trace.products ORDER BY created_at, id;

-- ── 3. Pallets ───────────────────────────────────────────────────────────
CREATE TABLE trace.pallets_new (
  id SERIAL PRIMARY KEY, old_id TEXT,
  pallet_code TEXT NOT NULL UNIQUE,
  product_id INTEGER NOT NULL,
  status trace."PalletStatus" NOT NULL DEFAULT 'IN_PRODUCTION'::trace."PalletStatus",
  notes TEXT,
  created_by INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO trace.pallets_new (old_id, pallet_code, product_id, status, notes, created_by, created_at, updated_at)
  SELECT p.id, p.pallet_code, pr.id, p.status, p.notes, u.id, p.created_at, p.updated_at
  FROM trace.pallets p
  JOIN trace.products_new pr ON pr.old_id = p.product_id
  JOIN trace.users_new u ON u.old_id = p.created_by
  ORDER BY p.created_at, p.id;

-- ── 4. Production details ────────────────────────────────────────────────
CREATE TABLE trace.pallet_production_details_new (
  id SERIAL PRIMARY KEY, old_id TEXT,
  pallet_id INTEGER NOT NULL,
  production_date DATE NOT NULL,
  shift TEXT NOT NULL, box_quantity INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO trace.pallet_production_details_new (old_id, pallet_id, production_date, shift, box_quantity, created_at)
  SELECT d.id, pl.id, d.production_date, d.shift, d.box_quantity, d.created_at
  FROM trace.pallet_production_details d
  JOIN trace.pallets_new pl ON pl.old_id = d.pallet_id
  ORDER BY d.created_at, d.id;

-- ── 5. Barcodes ──────────────────────────────────────────────────────────
CREATE TABLE trace.pallet_barcodes_new (
  id SERIAL PRIMARY KEY, old_id TEXT,
  barcode TEXT NOT NULL UNIQUE,
  pallet_id INTEGER NOT NULL,
  production_detail_id INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO trace.pallet_barcodes_new (old_id, barcode, pallet_id, production_detail_id, created_at)
  SELECT b.id, b.barcode, pl.id, pd.id, b.created_at
  FROM trace.pallet_barcodes b
  JOIN trace.pallets_new pl ON pl.old_id = b.pallet_id
  LEFT JOIN trace.pallet_production_details_new pd ON pd.old_id = b.production_detail_id
  ORDER BY b.created_at, b.id;

-- ── 6. Verifications ─────────────────────────────────────────────────────
CREATE TABLE trace.transit_verifications_new (
  id SERIAL PRIMARY KEY, old_id TEXT,
  pallet_id INTEGER NOT NULL,
  verified_by INTEGER NOT NULL,
  verified_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  raw_scan_data TEXT,
  unique_barcode_count INTEGER NOT NULL,
  verification_status trace."VerificationStatus" NOT NULL DEFAULT 'COMPLETE'::trace."VerificationStatus"
);
INSERT INTO trace.transit_verifications_new (old_id, pallet_id, verified_by, verified_at, raw_scan_data, unique_barcode_count, verification_status)
  SELECT v.id, pl.id, u.id, v.verified_at, v.raw_scan_data, v.unique_barcode_count, v.verification_status
  FROM trace.transit_verifications v
  JOIN trace.pallets_new pl ON pl.old_id = v.pallet_id
  JOIN trace.users_new u ON u.old_id = v.verified_by
  ORDER BY v.verified_at, v.id;

-- ── 7. Verification links ────────────────────────────────────────────────
CREATE TABLE trace.transit_verification_barcodes_new (
  id SERIAL PRIMARY KEY, old_id TEXT,
  verification_id INTEGER NOT NULL,
  pallet_barcode_id INTEGER NOT NULL
);
INSERT INTO trace.transit_verification_barcodes_new (old_id, verification_id, pallet_barcode_id)
  SELECT l.id, v.id, b.id
  FROM trace.transit_verification_barcodes l
  JOIN trace.transit_verifications_new v ON v.old_id = l.verification_id
  JOIN trace.pallet_barcodes_new b ON b.old_id = l.pallet_barcode_id;

-- ── 8. Movements ─────────────────────────────────────────────────────────
CREATE TABLE trace.pallet_movements_new (
  id SERIAL PRIMARY KEY, old_id TEXT,
  pallet_id INTEGER NOT NULL,
  from_location TEXT NOT NULL, to_location TEXT NOT NULL,
  from_status trace."PalletStatus" NOT NULL, to_status trace."PalletStatus" NOT NULL,
  performed_by INTEGER NOT NULL,
  performed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes TEXT
);
INSERT INTO trace.pallet_movements_new (old_id, pallet_id, from_location, to_location, from_status, to_status, performed_by, performed_at, notes)
  SELECT m.id, pl.id, m.from_location, m.to_location, m.from_status, m.to_status, u.id, m.performed_at, m.notes
  FROM trace.pallet_movements m
  JOIN trace.pallets_new pl ON pl.old_id = m.pallet_id
  JOIN trace.users_new u ON u.old_id = m.performed_by
  ORDER BY m.performed_at, m.id;

-- ── 9. Audit logs ────────────────────────────────────────────────────────
CREATE TABLE trace.audit_logs_new (
  id SERIAL PRIMARY KEY, old_id TEXT,
  actor_id INTEGER,
  action TEXT NOT NULL, entity TEXT NOT NULL, entity_id TEXT,
  detail TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO trace.audit_logs_new (old_id, actor_id, action, entity, entity_id, detail, created_at)
  SELECT l.id, u.id, l.action, l.entity, l.entity_id, l.detail, l.created_at
  FROM trace.audit_logs l
  LEFT JOIN trace.users_new u ON u.old_id = l.actor_id
  ORDER BY l.created_at, l.id;

-- ── 10. Tukar tabel lama → baru ──────────────────────────────────────────
DROP TABLE trace.transit_verification_barcodes,
  trace.transit_verifications,
  trace.pallet_barcodes,
  trace.pallet_production_details,
  trace.pallet_movements,
  trace.audit_logs,
  trace.pallets,
  trace.products,
  trace.users,
  trace.pallet_counters CASCADE;

ALTER TABLE trace.users_new RENAME TO users;
ALTER TABLE trace.products_new RENAME TO products;
ALTER TABLE trace.pallets_new RENAME TO pallets;
ALTER TABLE trace.pallet_production_details_new RENAME TO pallet_production_details;
ALTER TABLE trace.pallet_barcodes_new RENAME TO pallet_barcodes;
ALTER TABLE trace.transit_verifications_new RENAME TO transit_verifications;
ALTER TABLE trace.transit_verification_barcodes_new RENAME TO transit_verification_barcodes;
ALTER TABLE trace.pallet_movements_new RENAME TO pallet_movements;
ALTER TABLE trace.audit_logs_new RENAME TO audit_logs;

ALTER TABLE trace.users DROP COLUMN old_id;
ALTER TABLE trace.products DROP COLUMN old_id;
ALTER TABLE trace.pallets DROP COLUMN old_id;
ALTER TABLE trace.pallet_production_details DROP COLUMN old_id;
ALTER TABLE trace.pallet_barcodes DROP COLUMN old_id;
ALTER TABLE trace.transit_verifications DROP COLUMN old_id;
ALTER TABLE trace.transit_verification_barcodes DROP COLUMN old_id;
ALTER TABLE trace.pallet_movements DROP COLUMN old_id;
ALTER TABLE trace.audit_logs DROP COLUMN old_id;

-- ── 11. Foreign keys ─────────────────────────────────────────────────────
ALTER TABLE trace.pallets ADD CONSTRAINT pallets_product_id_fkey FOREIGN KEY (product_id) REFERENCES trace.products(id) ON DELETE NO ACTION;
ALTER TABLE trace.pallets ADD CONSTRAINT pallets_created_by_fkey FOREIGN KEY (created_by) REFERENCES trace.users(id) ON DELETE NO ACTION;
ALTER TABLE trace.pallet_production_details ADD CONSTRAINT pallet_production_details_pallet_id_fkey FOREIGN KEY (pallet_id) REFERENCES trace.pallets(id) ON DELETE CASCADE;
ALTER TABLE trace.pallet_barcodes ADD CONSTRAINT pallet_barcodes_pallet_id_fkey FOREIGN KEY (pallet_id) REFERENCES trace.pallets(id) ON DELETE CASCADE;
ALTER TABLE trace.pallet_barcodes ADD CONSTRAINT pallet_barcodes_production_detail_id_fkey FOREIGN KEY (production_detail_id) REFERENCES trace.pallet_production_details(id) ON DELETE SET NULL;
ALTER TABLE trace.transit_verifications ADD CONSTRAINT transit_verifications_pallet_id_fkey FOREIGN KEY (pallet_id) REFERENCES trace.pallets(id) ON DELETE CASCADE;
ALTER TABLE trace.transit_verifications ADD CONSTRAINT transit_verifications_verified_by_fkey FOREIGN KEY (verified_by) REFERENCES trace.users(id) ON DELETE NO ACTION;
ALTER TABLE trace.transit_verification_barcodes ADD CONSTRAINT transit_verification_barcodes_verification_id_fkey FOREIGN KEY (verification_id) REFERENCES trace.transit_verifications(id) ON DELETE CASCADE;
ALTER TABLE trace.transit_verification_barcodes ADD CONSTRAINT transit_verification_barcodes_pallet_barcode_id_fkey FOREIGN KEY (pallet_barcode_id) REFERENCES trace.pallet_barcodes(id) ON DELETE CASCADE;
ALTER TABLE trace.transit_verification_barcodes ADD CONSTRAINT transit_verification_barcodes_verification_id_pallet_barcode_id_key UNIQUE (verification_id, pallet_barcode_id);
ALTER TABLE trace.pallet_movements ADD CONSTRAINT pallet_movements_pallet_id_fkey FOREIGN KEY (pallet_id) REFERENCES trace.pallets(id) ON DELETE CASCADE;
ALTER TABLE trace.pallet_movements ADD CONSTRAINT pallet_movements_performed_by_fkey FOREIGN KEY (performed_by) REFERENCES trace.users(id) ON DELETE NO ACTION;
ALTER TABLE trace.audit_logs ADD CONSTRAINT audit_logs_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES trace.users(id) ON DELETE SET NULL;

-- ── 12. Indexes ──────────────────────────────────────────────────────────
CREATE INDEX users_username_idx ON trace.users(username);
CREATE INDEX users_role_idx ON trace.users(role);
CREATE INDEX products_product_code_idx ON trace.products(product_code);
CREATE INDEX pallets_product_id_idx ON trace.pallets(product_id);
CREATE INDEX pallets_status_idx ON trace.pallets(status);
CREATE INDEX pallets_created_at_idx ON trace.pallets(created_at);
CREATE INDEX pallet_production_details_pallet_id_idx ON trace.pallet_production_details(pallet_id);
CREATE INDEX pallet_production_details_production_date_idx ON trace.pallet_production_details(production_date);
CREATE INDEX pallet_production_details_shift_idx ON trace.pallet_production_details(shift);
CREATE INDEX pallet_barcodes_pallet_id_idx ON trace.pallet_barcodes(pallet_id);
CREATE INDEX transit_verifications_pallet_id_idx ON trace.transit_verifications(pallet_id);
CREATE INDEX transit_verifications_verified_at_idx ON trace.transit_verifications(verified_at);
CREATE INDEX transit_verification_barcodes_verification_id_idx ON trace.transit_verification_barcodes(verification_id);
CREATE INDEX transit_verification_barcodes_pallet_barcode_id_idx ON trace.transit_verification_barcodes(pallet_barcode_id);
CREATE INDEX pallet_movements_pallet_id_idx ON trace.pallet_movements(pallet_id);
CREATE INDEX pallet_movements_performed_at_idx ON trace.pallet_movements(performed_at);
CREATE INDEX audit_logs_entity_entity_id_idx ON trace.audit_logs(entity, entity_id);
CREATE INDEX audit_logs_created_at_idx ON trace.audit_logs(created_at);

-- ── 13. Counter bulanan (format PLT/yymm/nnnn) ───────────────────────────
CREATE TABLE trace.pallet_month_counters (
  yyyymm TEXT PRIMARY KEY,
  last_seq INTEGER NOT NULL DEFAULT 0
);

COMMIT;
