-- ============================================================
-- Berlaris Feature Migration — 2026-06-30
-- Sections A, B, C (schema), G
-- Jalankan di Supabase SQL Editor
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- SECTION A: Waste tracking
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS waste_logs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  waste_date    DATE NOT NULL DEFAULT CURRENT_DATE,
  ingredient_id UUID NOT NULL REFERENCES ingredients(id),
  qty           NUMERIC(10,3) NOT NULL CHECK (qty > 0),
  unit_id       UUID NOT NULL REFERENCES units(id),
  reason        TEXT NOT NULL CHECK (reason IN ('expired','dropped','spoiled','wrong_prep','other')),
  notes         TEXT,
  recorded_by   UUID REFERENCES users(id),
  recorded_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_waste_date       ON waste_logs (waste_date DESC);
CREATE INDEX IF NOT EXISTS idx_waste_ingredient ON waste_logs (ingredient_id);

COMMENT ON TABLE waste_logs IS
  'Catatan bahan terbuang. Dikurangkan dari theoretical_closing supaya variance report tidak salah anggap waste sebagai anomali.';

-- Tambah kolom waste_qty ke variance_reports (nullable, default 0)
ALTER TABLE variance_reports
  ADD COLUMN IF NOT EXISTS waste_qty NUMERIC(10,3) NOT NULL DEFAULT 0;

-- ────────────────────────────────────────────────────────────
-- SECTION B: Complementary/Test entries
-- ────────────────────────────────────────────────────────────

-- Tambah kolom entry_type dan notes ke daily_sales_entries
ALTER TABLE daily_sales_entries
  ADD COLUMN IF NOT EXISTS entry_type TEXT NOT NULL DEFAULT 'sale'
    CHECK (entry_type IN ('sale', 'complimentary', 'test')),
  ADD COLUMN IF NOT EXISTS notes TEXT;

-- DROP unique constraint lama (entry_date, menu_id) dan buat ulang
-- dengan (entry_date, menu_id, entry_type) supaya 1 menu bisa punya
-- entry 'sale' DAN 'complimentary' di tanggal yang sama.
-- Nama constraint mungkin berbeda di DB Anda — sesuaikan jika perlu.
DO $$
BEGIN
  -- Cari dan drop constraint unique yang ada
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'daily_sales_entries'
      AND constraint_type = 'UNIQUE'
      AND constraint_name LIKE '%entry_date%menu%'
  ) THEN
    EXECUTE (
      SELECT 'ALTER TABLE daily_sales_entries DROP CONSTRAINT ' || constraint_name
      FROM information_schema.table_constraints
      WHERE table_name = 'daily_sales_entries'
        AND constraint_type = 'UNIQUE'
        AND constraint_name LIKE '%entry_date%menu%'
      LIMIT 1
    );
  END IF;
END $$;

-- Buat constraint baru
ALTER TABLE daily_sales_entries
  DROP CONSTRAINT IF EXISTS daily_sales_entries_entry_date_menu_id_entry_type_key;

ALTER TABLE daily_sales_entries
  ADD CONSTRAINT daily_sales_entries_entry_date_menu_id_entry_type_key
  UNIQUE (entry_date, menu_id, entry_type);

-- ────────────────────────────────────────────────────────────
-- SECTION G: Recipe change audit log
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS recipe_change_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id     UUID NOT NULL REFERENCES recipes(id),
  menu_id       UUID NOT NULL REFERENCES menu_items(id),
  ingredient_id UUID NOT NULL REFERENCES ingredients(id),
  old_qty       NUMERIC(10,3) NOT NULL,
  new_qty       NUMERIC(10,3) NOT NULL,
  changed_by    UUID REFERENCES users(id),
  reason        TEXT,
  changed_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_recipe_log_menu ON recipe_change_log (menu_id);
CREATE INDEX IF NOT EXISTS idx_recipe_log_date ON recipe_change_log (changed_at DESC);

COMMENT ON TABLE recipe_change_log IS
  'Audit trail perubahan gramasi BOM. Tidak mempengaruhi data historis theoretical_consumption — hanya mempengaruhi kalkulasi sejak perubahan dilakukan.';

-- ────────────────────────────────────────────────────────────
-- TAMBAHAN: recipe_change_log — action column + nullable recipe_id
-- Jalankan setelah migration SECTION G di atas
-- ────────────────────────────────────────────────────────────

-- Tambah kolom action (tipe perubahan: qty_change | ingredient_added | ingredient_removed)
ALTER TABLE recipe_change_log
  ADD COLUMN IF NOT EXISTS action TEXT NOT NULL DEFAULT 'qty_change'
    CHECK (action IN ('qty_change', 'ingredient_added', 'ingredient_removed'));

-- Buat recipe_id nullable supaya delete recipe row tidak break log history
-- (ON DELETE SET NULL tidak bisa di-add retroaktif tanpa recreate FK)
ALTER TABLE recipe_change_log ALTER COLUMN recipe_id DROP NOT NULL;
