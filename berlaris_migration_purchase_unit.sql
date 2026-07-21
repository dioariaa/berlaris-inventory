-- Migration: Purchase Unit Conversion
-- Tambah purchase_unit + conversion_factor ke ingredients
-- Jalankan di Supabase SQL Editor

ALTER TABLE ingredients
  ADD COLUMN IF NOT EXISTS purchase_unit VARCHAR(20),
  ADD COLUMN IF NOT EXISTS conversion_factor DECIMAL(10,2) NOT NULL DEFAULT 1;

-- purchase_unit nullable — kalau NULL, admin beli dalam base_unit (no conversion)
-- conversion_factor default 1 — semua ingredient existing tetap jalan tanpa perubahan
-- Formula: 1 purchase_unit = conversion_factor × base_unit
-- Contoh: purchase_unit='kg', base_unit='g', conversion_factor=1000
--         → admin beli 2 kg, ledger terima 2000 g
