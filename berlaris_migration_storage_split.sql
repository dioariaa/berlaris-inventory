-- Migration: split Storage jadi Storage Bar & Storage Kitchen (2026-07-02)
-- Jalankan SEKALI di Supabase SQL Editor (setelah berlaris_migration_stock_transfers.sql).
--
-- Lokasi stok sekarang 6: storage_bar, storage_kitchen, bar, kitchen,
-- staff_meal, operational. Kategori belanja (po_category) menentukan lokasi
-- stok masuk; NULL (initial stock / receipt lama) → storage sesuai division.

-- 1. receipt_items.po_category: izinkan 2 kategori storage baru
ALTER TABLE receipt_items DROP CONSTRAINT IF EXISTS receipt_items_po_category_check;
ALTER TABLE receipt_items ADD CONSTRAINT receipt_items_po_category_check
  CHECK (po_category IN ('storage_bar','storage_kitchen','kitchen','bar','staff_meal','operational'));

-- 2. stock_transfers: migrasi row 'storage' lama ke storage per division ingredient
UPDATE stock_transfers t
SET from_location = CASE WHEN i.division = 'bar' THEN 'storage_bar' ELSE 'storage_kitchen' END
FROM ingredients i
WHERE i.id = t.ingredient_id AND t.from_location = 'storage';

UPDATE stock_transfers t
SET to_location = CASE WHEN i.division = 'bar' THEN 'storage_bar' ELSE 'storage_kitchen' END
FROM ingredients i
WHERE i.id = t.ingredient_id AND t.to_location = 'storage';

-- 3. Perbarui CHECK constraint lokasi transfer
ALTER TABLE stock_transfers DROP CONSTRAINT IF EXISTS stock_transfers_from_location_check;
ALTER TABLE stock_transfers DROP CONSTRAINT IF EXISTS stock_transfers_to_location_check;
ALTER TABLE stock_transfers ADD CONSTRAINT stock_transfers_from_location_check
  CHECK (from_location IN ('storage_bar','storage_kitchen','bar','kitchen','staff_meal','operational'));
ALTER TABLE stock_transfers ADD CONSTRAINT stock_transfers_to_location_check
  CHECK (to_location IN ('storage_bar','storage_kitchen','bar','kitchen','staff_meal','operational'));
