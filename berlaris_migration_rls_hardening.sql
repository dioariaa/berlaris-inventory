-- ============================================================
-- Migration: RLS Hardening (2026-07-21)
-- ============================================================
-- Konteks: berlaris_schema.sql meng-ENABLE RLS pada 10 tabel tapi
-- SEMUA policy-nya masih dikomentari, DAN belasan tabel lain tidak
-- pernah di-enable sama sekali. Akibatnya tabel yang RLS-nya OFF
-- terbuka untuk anon key (yang publik, ter-bundle di frontend).
--
-- Strategi: DENY-BY-DEFAULT untuk anon/authenticated di SELURUH tabel.
-- Semua akses sah lewat FastAPI memakai service_role, yang OTOMATIS
-- bypass RLS — jadi backend tetap berfungsi penuh tanpa policy apa pun.
--
-- Jalankan SEKALI di Supabase SQL Editor project Berlaris
-- (ref: xvzujceymyozqztdongm). Idempotent — aman dijalankan ulang.
--
-- PERINGATAN: setelah ini, Realtime subscription anon di frontend
-- (Dashboard.jsx, StockLevels.jsx) akan BERHENTI menerima event,
-- karena koneksi Realtime berjalan sebagai role anon (frontend tidak
-- login ke Supabase Auth). Lihat blok "OPSIONAL: Realtime" di bawah
-- untuk dua jalur penanganan.
-- ============================================================


-- ────────────────────────────────────────────────────────────
-- 1. ENABLE RLS di SEMUA tabel public
--    ALTER ... ENABLE bersifat idempotent (no-op jika sudah aktif),
--    jadi 10 tabel yang sudah di-enable di schema aman diulang.
--    Prasyarat: semua tabel & migration lain sudah dijalankan. Kalau
--    ada baris yang error "relation does not exist", jalankan migration
--    tabel itu dulu atau komentari (--) barisnya, lalu ulangi.
-- ────────────────────────────────────────────────────────────

-- Master data
ALTER TABLE users                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE units                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE unit_conversions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE ingredients             ENABLE ROW LEVEL SECURITY;
ALTER TABLE menu_items              ENABLE ROW LEVEL SECURITY;
ALTER TABLE recipes                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendors                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE ingredient_vendors      ENABLE ROW LEVEL SECURITY;
ALTER TABLE production_processes    ENABLE ROW LEVEL SECURITY;
ALTER TABLE production_stages       ENABLE ROW LEVEL SECURITY;
ALTER TABLE production_outputs      ENABLE ROW LEVEL SECURITY;

-- Operasional harian
ALTER TABLE daily_sales_entries     ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_stock_opname      ENABLE ROW LEVEL SECURITY;
ALTER TABLE production_batches      ENABLE ROW LEVEL SECURITY;

-- Kalkulasi
ALTER TABLE theoretical_consumption ENABLE ROW LEVEL SECURITY;
ALTER TABLE ingredient_cost_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE menu_hpp                ENABLE ROW LEVEL SECURITY;
ALTER TABLE variance_reports        ENABLE ROW LEVEL SECURITY;

-- PO & pembelian
ALTER TABLE purchase_orders         ENABLE ROW LEVEL SECURITY;
ALTER TABLE po_items                ENABLE ROW LEVEL SECURITY;
ALTER TABLE goods_receipts          ENABLE ROW LEVEL SECURITY;
ALTER TABLE receipt_items           ENABLE ROW LEVEL SECURITY;

-- Audit
ALTER TABLE audit_logs              ENABLE ROW LEVEL SECURITY;

-- Tabel migration (fitur tambahan)
ALTER TABLE waste_logs              ENABLE ROW LEVEL SECURITY;
ALTER TABLE recipe_change_log       ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_transfers         ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_adjustments       ENABLE ROW LEVEL SECURITY;

-- Catatan: TIDAK ada CREATE POLICY di sini. Tanpa policy, RLS menolak
-- SEMUA akses anon/authenticated (default-deny). service_role bypass RLS
-- sehingga FastAPI tetap punya akses penuh. Ini postur yang diinginkan.


-- ────────────────────────────────────────────────────────────
-- 2. OPSIONAL: Realtime — pilih SATU jika ingin Realtime tetap hidup
-- ────────────────────────────────────────────────────────────
-- Frontend saat ini subscribe (sebagai anon) ke tabel:
--   variance_reports, daily_stock_opname, production_batches   (Dashboard.jsx)
--   receipt_items, production_batches, stock_transfers, ...    (StockLevels.jsx)
-- Payload event hanya dipakai sebagai SINYAL untuk memicu refetch via FastAPI
-- (bukan data-nya). Jadi:
--
--   OPSI A (REKOMENDASI, paling aman): buang Supabase Realtime,
--   ganti polling `GET /stock/current` & dashboard tiap N detik.
--   Tidak perlu policy apa pun — biarkan tabel deny-total.
--   (Perubahan di sisi frontend, bukan SQL.)
--
--   OPSI B: buat frontend login ke Supabase Auth (punya sesi authenticated
--   sungguhan), LALU beri SELECT ke authenticated HANYA pada tabel sinyal.
--   Aktifkan blok di bawah HANYA jika memilih Opsi B:
--
-- CREATE POLICY realtime_read_authenticated ON variance_reports
--   FOR SELECT TO authenticated USING (true);
-- CREATE POLICY realtime_read_authenticated ON daily_stock_opname
--   FOR SELECT TO authenticated USING (true);
-- CREATE POLICY realtime_read_authenticated ON production_batches
--   FOR SELECT TO authenticated USING (true);
-- CREATE POLICY realtime_read_authenticated ON receipt_items
--   FOR SELECT TO authenticated USING (true);
-- CREATE POLICY realtime_read_authenticated ON stock_transfers
--   FOR SELECT TO authenticated USING (true);
--
-- CATATAN: JANGAN beri policy ke role `anon`. anon key publik — memberi
-- SELECT ke anon sama saja membuka data biaya ke siapa pun.


-- ────────────────────────────────────────────────────────────
-- 3. VERIFIKASI — jalankan setelah migration untuk konfirmasi
-- ────────────────────────────────────────────────────────────
-- Harusnya SEMUA baris rls_enabled = true. Baris jml_policy > 0 hanya
-- muncul kalau Opsi B dipakai.

SELECT c.relname AS tabel,
       c.relrowsecurity AS rls_enabled,
       (SELECT count(*) FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = c.relname) AS jml_policy
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r'
ORDER BY c.relrowsecurity, tabel;
