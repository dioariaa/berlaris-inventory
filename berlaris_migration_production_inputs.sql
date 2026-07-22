-- ============================================================
-- Migration: Multi-input production — Arsitektur B (2026-07-21)
-- ============================================================
-- Bumbu/sambal = ingredient processed dengan stok sendiri.
-- Komposisi multi-bahan:
--   production_inputs = resep standar per proses (plan, prefill UI)
--   batch_inputs      = qty aktual per batch (DIBACA LEDGER:
--                       stock_level.py & variance.py)
-- Batch tanpa baris batch_inputs = legacy single-raw (fallback
-- kolom raw_qty_used/raw_unit_id — TANPA backfill, no double-count).
--
-- Jalankan SEKALI di Supabase SQL Editor project Berlaris
-- (ref: xvzujceymyozqztdongm). Idempotent untuk CREATE (IF NOT
-- EXISTS); ALTER DROP NOT NULL & TYPE aman diulang (no-op).
-- ============================================================

-- ── 1. Resep standar per proses (plan) ──────────────────────
CREATE TABLE IF NOT EXISTS production_inputs (
  id             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  process_id     UUID          NOT NULL REFERENCES production_processes(id) ON DELETE CASCADE,
  ingredient_id  UUID          NOT NULL REFERENCES ingredients(id),
  qty_per_batch  NUMERIC(12,3) NOT NULL CHECK (qty_per_batch > 0),
  unit_id        UUID          NOT NULL REFERENCES units(id),
  notes          TEXT,
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT now(),
  UNIQUE (process_id, ingredient_id)
);
CREATE INDEX IF NOT EXISTS idx_prod_inputs_process ON production_inputs (process_id);
COMMENT ON TABLE production_inputs IS
  'Komposisi standar 1 batch (multi-input, mis. bumbu/sambal). Plan — ledger membaca batch_inputs.';

-- ── 2. Input aktual per batch (dibaca stock_level & variance) ─
CREATE TABLE IF NOT EXISTS batch_inputs (
  id             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id       UUID          NOT NULL REFERENCES production_batches(id) ON DELETE CASCADE,
  ingredient_id  UUID          NOT NULL REFERENCES ingredients(id),
  qty_used       NUMERIC(12,3) NOT NULL CHECK (qty_used > 0),
  unit_id        UUID          NOT NULL REFERENCES units(id),
  created_at     TIMESTAMPTZ   NOT NULL DEFAULT now(),
  UNIQUE (batch_id, ingredient_id)
);
CREATE INDEX IF NOT EXISTS idx_batch_inputs_batch      ON batch_inputs (batch_id);
CREATE INDEX IF NOT EXISTS idx_batch_inputs_ingredient ON batch_inputs (ingredient_id);
COMMENT ON TABLE batch_inputs IS
  'Qty aktual tiap bahan dalam 1 batch produksi. Batch tanpa baris di sini = legacy single-raw.';

-- ── 3. Legacy compatibility — kolom single-raw jadi opsional ──
-- CHECK (raw_qty_used > 0) TETAP berlaku: NULL lolos CHECK di
-- Postgres, nilai non-NULL tetap wajib > 0.
ALTER TABLE production_processes ALTER COLUMN raw_ingredient_id DROP NOT NULL;
ALTER TABLE production_batches   ALTER COLUMN raw_qty_used      DROP NOT NULL;
ALTER TABLE production_batches   ALTER COLUMN raw_unit_id       DROP NOT NULL;

-- ── 4. Presisi cost per base unit (bumbu per gram bisa < Rp 0,01)
ALTER TABLE ingredients ALTER COLUMN avg_cost_per_unit TYPE NUMERIC(14,4);

-- ── 5. RLS — konsisten hardening default-deny (2026-07-21) ────
ALTER TABLE production_inputs ENABLE ROW LEVEL SECURITY;
ALTER TABLE batch_inputs      ENABLE ROW LEVEL SECURITY;

-- ── VERIFIKASI ────────────────────────────────────────────────
SELECT c.relname AS tabel, c.relrowsecurity AS rls_enabled
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname IN ('production_inputs', 'batch_inputs');

SELECT column_name, is_nullable, data_type, numeric_precision, numeric_scale
FROM information_schema.columns
WHERE (table_name = 'production_processes' AND column_name = 'raw_ingredient_id')
   OR (table_name = 'production_batches'   AND column_name IN ('raw_qty_used', 'raw_unit_id'))
   OR (table_name = 'ingredients'          AND column_name = 'avg_cost_per_unit');
