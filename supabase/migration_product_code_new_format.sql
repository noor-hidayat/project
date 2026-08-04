-- =============================================================
-- Migrasi: ubah product_code data lama ke format baru
-- Format baru = 7 karakter kode produk + '-' + check digit (1 digit)
-- Format barcode tidak berubah, jadi format baru diturunkan dari barcode:
--   posisi 4-10 = kode produk (7 karakter)
--   posisi 11   = check digit (1 digit)
-- =============================================================

-- 1) PRATINJAU - jalankan dulu, pastikan hasil sesuai
SELECT
  barcode,
  product_code AS product_code_lama,
  CONCAT(SUBSTRING(barcode, 4, 7), '-', SUBSTRING(barcode, 11, 1)) AS product_code_baru
FROM scan_logs
WHERE barcode ~ '^[0-9]{3}[A-Za-z0-9_]{7}[0-9][0-9]{6}[0-9]{2}[A-Za-z0-9_]{3}-[0-9]{3}$'
  AND product_code NOT LIKE '%-%';

-- 2) UPDATE scan_logs
UPDATE scan_logs
SET product_code = CONCAT(SUBSTRING(barcode, 4, 7), '-', SUBSTRING(barcode, 11, 1))
WHERE barcode ~ '^[0-9]{3}[A-Za-z0-9_]{7}[0-9][0-9]{6}[0-9]{2}[A-Za-z0-9_]{3}-[0-9]{3}$'
  AND product_code NOT LIKE '%-%';

-- 3) UPDATE products.code mengikuti check digit dari barcode
UPDATE products p
SET code = x.product_code_baru
FROM (
  SELECT DISTINCT
    SUBSTRING(sl.barcode, 4, 7) AS product_code_lama,
    CONCAT(SUBSTRING(sl.barcode, 4, 7), '-', SUBSTRING(sl.barcode, 11, 1)) AS product_code_baru
  FROM scan_logs sl
  WHERE sl.barcode ~ '^[0-9]{3}[A-Za-z0-9_]{7}[0-9][0-9]{6}[0-9]{2}[A-Za-z0-9_]{3}-[0-9]{3}$'
) x
WHERE p.code = x.product_code_lama;

-- 4) Cek sisa yang belum ter-update
-- (produk yang tidak punya barcode sama sekali tidak bisa diturunkan -> isi manual)
SELECT code FROM products WHERE code NOT LIKE '%-%';
