-- ============================================================
-- Migration: Initial Stock (opening balance) + package_size referensi
-- Jalankan sekali di Supabase SQL Editor sebelum memakai fitur:
--   - Stok Awal (POST/GET /stock/initial)
--   - Kolom "Kemasan" di halaman Input Stok Awal
-- ============================================================

-- 1. Tandai goods_receipts sebagai initial stock (opening balance)
--    Baris initial stock TIDAK mempengaruhi avg_cost ingredient dan
--    bukan pembelian baru — hanya pencatatan qty awal saat sistem
--    pertama kali dipakai.
ALTER TABLE goods_receipts
  ADD COLUMN IF NOT EXISTS is_initial_stock BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN goods_receipts.is_initial_stock IS
  'true = opening balance/stok awal saat sistem pertama kali dipakai. '
  'Bukan pembelian baru. Tidak mempengaruhi avg_cost ingredient.';

-- 2. Info kemasan beli (referensi admin, bukan base_unit)
--    Contoh: '1000gr', '750ml', '25bag', '8L', '100pcs'
--    Membantu admin tahu "1 kemasan = berapa gram/ml" saat input stok awal
--    atau belanja harian. NULL untuk bahan tanpa kemasan standar (buah segar dll).
ALTER TABLE ingredients
  ADD COLUMN IF NOT EXISTS package_size TEXT;

COMMENT ON COLUMN ingredients.package_size IS
  'Info kemasan beli untuk referensi admin (mis. "1000gr", "750ml", "25bag"). '
  'Bukan base_unit — hanya membantu konversi mental saat input stok/belanja. '
  'NULL untuk bahan tanpa kemasan standar (buah segar, dll).';
