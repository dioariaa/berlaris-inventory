-- ============================================================
-- ROLLBACK: RLS Hardening (pasangan berlaris_migration_rls_hardening.sql)
-- ============================================================
-- Menonaktifkan kembali RLS pada 27 tabel yang di-enable oleh
-- berlaris_migration_rls_hardening.sql — daftar & urutan tabel
-- diambil 1:1 dari file migration tersebut (2026-07-21).
--
-- Jalankan di Supabase SQL Editor project Berlaris
-- (ref: xvzujceymyozqztdongm) HANYA jika hardening perlu di-undo.
-- Idempotent — ALTER ... DISABLE no-op jika RLS sudah nonaktif.
--
-- PERINGATAN: setelah rollback, tabel kembali TERBUKA untuk anon key
-- (postur sebelum hardening). Gunakan hanya sebagai emergency rollback,
-- bukan solusi permanen.
-- ============================================================

-- Master data
ALTER TABLE public.users                   DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.units                   DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.unit_conversions        DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.ingredients             DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.menu_items              DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.recipes                 DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendors                 DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.ingredient_vendors      DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_processes    DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_stages       DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_outputs      DISABLE ROW LEVEL SECURITY;

-- Operasional harian
ALTER TABLE public.daily_sales_entries     DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_stock_opname      DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_batches      DISABLE ROW LEVEL SECURITY;

-- Kalkulasi
ALTER TABLE public.theoretical_consumption DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.ingredient_cost_history DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.menu_hpp                DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.variance_reports        DISABLE ROW LEVEL SECURITY;

-- PO & pembelian
ALTER TABLE public.purchase_orders         DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.po_items                DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.goods_receipts          DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.receipt_items           DISABLE ROW LEVEL SECURITY;

-- Audit
ALTER TABLE public.audit_logs              DISABLE ROW LEVEL SECURITY;

-- Tabel migration (fitur tambahan)
ALTER TABLE public.waste_logs              DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.recipe_change_log       DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_transfers         DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_adjustments       DISABLE ROW LEVEL SECURITY;

-- Multi-input production (berlaris_migration_production_inputs.sql, 2026-07-21)
-- Baris ini error "relation does not exist" jika migration itu belum pernah
-- dijalankan — komentari saja kalau begitu.
ALTER TABLE public.production_inputs       DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.batch_inputs            DISABLE ROW LEVEL SECURITY;

-- ────────────────────────────────────────────────────────────
-- Bersihkan policy Opsi B (Realtime) JIKA sempat dibuat.
-- DROP POLICY IF EXISTS aman dijalankan walau policy tidak pernah ada.
-- ────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS realtime_read_authenticated ON public.variance_reports;
DROP POLICY IF EXISTS realtime_read_authenticated ON public.daily_stock_opname;
DROP POLICY IF EXISTS realtime_read_authenticated ON public.production_batches;
DROP POLICY IF EXISTS realtime_read_authenticated ON public.receipt_items;
DROP POLICY IF EXISTS realtime_read_authenticated ON public.stock_transfers;

-- ────────────────────────────────────────────────────────────
-- VERIFIKASI — semua baris harus rls_enabled = false setelah rollback
-- ────────────────────────────────────────────────────────────
SELECT c.relname AS tabel,
       c.relrowsecurity AS rls_enabled,
       (SELECT count(*) FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = c.relname) AS jml_policy
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r'
ORDER BY c.relrowsecurity, tabel;
