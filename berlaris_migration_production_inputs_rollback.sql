-- ============================================================
-- ROLLBACK: Multi-input production
-- (pasangan berlaris_migration_production_inputs.sql, 2026-07-21)
-- ============================================================
-- PERINGATAN URUTAN & PRASYARAT:
--   SET NOT NULL hanya valid jika TIDAK ADA baris NULL di kolom
--   tersebut — yaitu selama belum ada batch multi-input nyata
--   (raw_qty_used IS NULL) atau proses multi-input nyata
--   (raw_ingredient_id IS NULL). Kalau sudah ada, statement-nya
--   GAGAL — dan itu disengaja: jangan hapus data produksi nyata
--   secara diam-diam. Bersihkan manual dulu (lihat blok opsional).
-- ============================================================

-- ── 0. OPSIONAL & DESTRUKTIF — hanya jika sudah ada data multi-input
--       dan kamu SADAR data itu akan hilang. Default: dikomentari.
-- DELETE FROM batch_inputs;
-- DELETE FROM production_batches   WHERE raw_qty_used IS NULL;
-- DELETE FROM production_inputs;
-- UPDATE production_processes SET is_active = false WHERE raw_ingredient_id IS NULL;
-- DELETE FROM production_processes WHERE raw_ingredient_id IS NULL; -- gagal jika masih direferensikan batch

-- ── 1. Hapus kedua tabel baru ─────────────────────────────────
DROP TABLE IF EXISTS batch_inputs;
DROP TABLE IF EXISTS production_inputs;

-- ── 2. Kembalikan constraint NOT NULL kolom legacy ───────────
ALTER TABLE production_processes ALTER COLUMN raw_ingredient_id SET NOT NULL;
ALTER TABLE production_batches   ALTER COLUMN raw_qty_used      SET NOT NULL;
ALTER TABLE production_batches   ALTER COLUMN raw_unit_id       SET NOT NULL;

-- ── 3. OPSIONAL: kembalikan presisi avg_cost_per_unit ─────────
--       DIKOMENTARI dengan sengaja — menyempitkan NUMERIC(14,4) →
--       (14,2) MEMBULATKAN nilai yang sudah tersimpan (lossy).
--       Biarkan (14,4) kecuali ada alasan kuat.
-- ALTER TABLE ingredients ALTER COLUMN avg_cost_per_unit TYPE NUMERIC(14,2);

-- ── VERIFIKASI ────────────────────────────────────────────────
-- Harusnya: production_inputs & batch_inputs TIDAK muncul;
-- ketiga kolom is_nullable = NO.
SELECT c.relname AS tabel FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r'
  AND c.relname IN ('production_inputs', 'batch_inputs');

SELECT table_name, column_name, is_nullable
FROM information_schema.columns
WHERE (table_name = 'production_processes' AND column_name = 'raw_ingredient_id')
   OR (table_name = 'production_batches'   AND column_name IN ('raw_qty_used', 'raw_unit_id'));
