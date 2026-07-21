-- ============================================================
-- FIX SEED: Perbaikan berdasarkan update CLAUDE.md
-- 1. Cabai: ganti 2 entry lama → 5 jenis terpisah
-- 2. Springroll: ganti 1 entry lama → 2 ingredient terpisah (Kecil TYJ + Besar TYJ)
-- Run di Supabase SQL Editor
-- ============================================================

-- ── 1. CABAI ──────────────────────────────────────────────
-- Hapus entry lama yang salah
DELETE FROM ingredients WHERE name IN ('Cabai Merah', 'Cabai Rawit');

-- Insert 5 jenis terpisah (semuanya dari SAYURANZ)
INSERT INTO ingredients (name, ingredient_type, division, base_unit_id, avg_cost_per_unit, notes) VALUES
  ('Cabai Rawit Merah',   'raw', 'kitchen', '90222804-fe6a-4b4d-b8a2-37149ecbfa23', 80, 'Paling pedas, ~Rp 80.000/kg — SAYURANZ'),
  ('Cabai Rawit Hijau',   'raw', 'kitchen', '90222804-fe6a-4b4d-b8a2-37149ecbfa23', 70, 'Varian hijau rawit — SAYURANZ'),
  ('Cabai Keriting Merah','raw', 'kitchen', '90222804-fe6a-4b4d-b8a2-37149ecbfa23', 50, '~Rp 50.000/kg — SAYURANZ'),
  ('Cabai TW Merah',      'raw', 'kitchen', '90222804-fe6a-4b4d-b8a2-37149ecbfa23', 47, 'Bukan singkatan, nama jenis. ~Rp 47.000/kg — SAYURANZ'),
  ('Cabai TW Hijau',      'raw', 'kitchen', '90222804-fe6a-4b4d-b8a2-37149ecbfa23', 45, 'Varian hijau dari TW — SAYURANZ');

-- ── 2. SPRINGROLL ─────────────────────────────────────────
-- Hapus entry lama yang digabung
DELETE FROM ingredients WHERE name = 'Kulit Springroll';

-- Insert 2 ingredient terpisah
INSERT INTO ingredients (name, ingredient_type, division, base_unit_id, avg_cost_per_unit, notes) VALUES
  ('Kulit Springroll Kecil (TYJ)', 'raw', 'kitchen', '1a950b9b-1d29-4af9-bbee-d62bdfd2b039', 800,
   'per lembar — untuk Springroll @5pcs/porsi dan Risol Soto'),
  ('Kulit Springroll Besar (TYJ)', 'raw', 'kitchen', '1a950b9b-1d29-4af9-bbee-d62bdfd2b039', 1200,
   'per lembar — untuk Samosa');

-- ── VERIFY ────────────────────────────────────────────────
SELECT name, ingredient_type, division, avg_cost_per_unit
FROM ingredients
WHERE name ILIKE '%cabai%' OR name ILIKE '%springroll%'
ORDER BY name;
