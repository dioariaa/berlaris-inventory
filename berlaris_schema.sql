-- ============================================================
-- BERLARIS INVENTORY & COST INTELLIGENCE SYSTEM
-- Supabase / PostgreSQL DDL — v1.0
-- 22 tables + indexes + triggers + seed data
-- ============================================================
-- Run this in Supabase SQL Editor (top-to-bottom, all at once)
-- ============================================================


-- ============================================================
-- 0. EXTENSIONS
-- ============================================================
CREATE EXTENSION IF NOT EXISTS "pgcrypto";


-- ============================================================
-- 1. SEQUENCES
-- ============================================================
CREATE SEQUENCE IF NOT EXISTS po_number_seq START 1;


-- ============================================================
-- 2. HELPER FUNCTION — updated_at trigger
-- ============================================================
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- ============================================================
-- 3. FUNCTION — auto-generate PO number
-- Format: PO-YYYY-MM-NNN (e.g. PO-2026-05-001)
-- ============================================================
CREATE OR REPLACE FUNCTION generate_po_number()
RETURNS TEXT AS $$
BEGIN
  RETURN 'PO-'
    || TO_CHAR(CURRENT_DATE, 'YYYY-MM')
    || '-'
    || LPAD(nextval('po_number_seq')::TEXT, 3, '0');
END;
$$ LANGUAGE plpgsql;


-- ============================================================
-- 4. TABLES — dependency order
-- ============================================================


-- ------------------------------------------------------------
-- 4.1 users
-- Roles: admin (full access), owner (read-only dashboard)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  email       TEXT        NOT NULL UNIQUE,
  name        TEXT        NOT NULL,
  role        TEXT        NOT NULL DEFAULT 'admin'
                          CHECK (role IN ('admin', 'owner')),
  is_active   BOOLEAN     NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE  users          IS 'System users. role=admin: full access. role=owner: read-only dashboard.';
COMMENT ON COLUMN users.role     IS 'admin | owner';


-- ------------------------------------------------------------
-- 4.2 units
-- Measurement units used across all ingredient and recipe tables
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS units (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT        NOT NULL UNIQUE, -- gram, ml, pcs, kg, liter, botol, galon, pack, porsi, pax, buah
  symbol      TEXT        NOT NULL,        -- g, ml, pcs, kg, L, btl, gal, pk, prs, pax, bh
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE units IS 'Units of measurement. Base units and trade units for ingredients and recipes.';


-- ------------------------------------------------------------
-- 4.3 unit_conversions
-- e.g. 1 botol = 700 ml → from=botol, to=ml, factor=700
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS unit_conversions (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  from_unit_id UUID         NOT NULL REFERENCES units(id),
  to_unit_id   UUID         NOT NULL REFERENCES units(id),
  factor       NUMERIC(14,6) NOT NULL CHECK (factor > 0),
  notes        TEXT,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (from_unit_id, to_unit_id),
  CHECK (from_unit_id <> to_unit_id)
);

COMMENT ON TABLE  unit_conversions        IS 'Conversion factors between units. factor = how many to_units per 1 from_unit.';
COMMENT ON COLUMN unit_conversions.factor IS 'Multiply qty in from_unit by factor to get qty in to_unit.';


-- ------------------------------------------------------------
-- 4.4 ingredients
-- type: raw = dibeli dari vendor
--       processed = hasil produksi kitchen/bar (e.g. Ayam Suir @20gr)
--       packaging = kemasan, tidak masuk HPP menu
-- division: kitchen | bar | both
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ingredients (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  name             TEXT         NOT NULL,
  ingredient_type  TEXT         NOT NULL CHECK (ingredient_type IN ('raw', 'processed', 'packaging')),
  division         TEXT         NOT NULL CHECK (division IN ('kitchen', 'bar', 'both')),
  base_unit_id     UUID         NOT NULL REFERENCES units(id),
  portion_size_g   NUMERIC(10,3),      -- for processed: berat per porsi dalam gram
  min_threshold    NUMERIC(10,3),      -- minimum stock sebelum alert
  avg_cost_per_unit NUMERIC(14,2) NOT NULL DEFAULT 0, -- weighted avg cost, di-update saat goods receipt
  is_active        BOOLEAN      NOT NULL DEFAULT true,
  notes            TEXT,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX idx_ingredients_type     ON ingredients (ingredient_type);
CREATE INDEX idx_ingredients_division ON ingredients (division);
CREATE INDEX idx_ingredients_active   ON ingredients (is_active);

CREATE TRIGGER trg_ingredients_updated_at
  BEFORE UPDATE ON ingredients
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE  ingredients                  IS 'Master bahan baku (raw) dan bahan olahan (processed). Packaging tidak masuk kalkulasi HPP.';
COMMENT ON COLUMN ingredients.portion_size_g   IS 'Khusus processed: berat 1 porsi dalam gram (e.g. Ayam Suir = 20).';
COMMENT ON COLUMN ingredients.avg_cost_per_unit IS 'Weighted average cost per base_unit. Di-update otomatis saat goods_receipt dikonfirmasi.';


-- ------------------------------------------------------------
-- 4.5 menu_items
-- category examples: breakfast, snack, main_course, soup,
--   burger_sandwich, pasta, salad, dessert, rice_bowl,
--   beverage_coffee, beverage_tea, beverage_mocktail, etc.
-- is_seasonal + valid_from + valid_until: untuk menu event
--   (Idul Adha, Idul Fitri, dll). BOM tetap tersimpan setelah nonaktif.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS menu_items (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT         NOT NULL,
  category      TEXT         NOT NULL,
  division      TEXT         NOT NULL CHECK (division IN ('kitchen', 'bar')),
  selling_price NUMERIC(12,2) NOT NULL CHECK (selling_price > 0),
  is_active     BOOLEAN      NOT NULL DEFAULT true,
  is_seasonal   BOOLEAN      NOT NULL DEFAULT false,
  valid_from    DATE,        -- null = tidak ada batas mulai
  valid_until   DATE,        -- null = tidak ada batas akhir
  notes         TEXT,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CHECK (valid_from IS NULL OR valid_until IS NULL OR valid_from <= valid_until)
);

CREATE INDEX idx_menu_items_category   ON menu_items (category);
CREATE INDEX idx_menu_items_division   ON menu_items (division);
CREATE INDEX idx_menu_items_active     ON menu_items (is_active);
CREATE INDEX idx_menu_items_seasonal   ON menu_items (is_seasonal) WHERE is_seasonal = true;

CREATE TRIGGER trg_menu_items_updated_at
  BEFORE UPDATE ON menu_items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE  menu_items            IS 'Master menu. Seasonal menus pakai valid_from/valid_until. BOM tetap ada setelah expired untuk laporan historis.';
COMMENT ON COLUMN menu_items.is_seasonal IS 'true = menu event (Idul Adha, Idul Fitri, dll). Aktif hanya dalam range valid_from–valid_until.';


-- ------------------------------------------------------------
-- 4.6 recipes (Bill of Materials)
-- Setiap menu punya daftar ingredient (processed atau raw) beserta qty
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS recipes (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  menu_id       UUID         NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  ingredient_id UUID         NOT NULL REFERENCES ingredients(id),
  qty           NUMERIC(10,3) NOT NULL CHECK (qty > 0),
  unit_id       UUID         NOT NULL REFERENCES units(id),
  notes         TEXT,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (menu_id, ingredient_id)
);

CREATE INDEX idx_recipes_menu_id       ON recipes (menu_id);
CREATE INDEX idx_recipes_ingredient_id ON recipes (ingredient_id);

CREATE TRIGGER trg_recipes_updated_at
  BEFORE UPDATE ON recipes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE recipes IS 'Bill of Materials per menu. qty adalah jumlah ingredient per 1 porsi menu.';


-- ------------------------------------------------------------
-- 4.7 vendors
-- 14 vendor aktif dari data belanja Mei 2026
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vendors (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT         NOT NULL,
  contact_name    TEXT,
  contact_phone   TEXT,
  address         TEXT,
  lead_time_days  INTEGER      DEFAULT 1 CHECK (lead_time_days >= 0),
  payment_terms   TEXT,        -- e.g. 'COD', '7 hari', 'bulanan'
  is_active       BOOLEAN      NOT NULL DEFAULT true,
  notes           TEXT,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_vendors_updated_at
  BEFORE UPDATE ON vendors
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE vendors IS 'Master vendor/supplier. lead_time_days = rata-rata waktu pengiriman dalam hari.';


-- ------------------------------------------------------------
-- 4.8 ingredient_vendors
-- Mapping ingredient ke vendor + harga terakhir
-- is_primary_vendor = vendor utama untuk ingredient ini
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ingredient_vendors (
  id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  ingredient_id       UUID         NOT NULL REFERENCES ingredients(id),
  vendor_id           UUID         NOT NULL REFERENCES vendors(id),
  is_primary_vendor   BOOLEAN      NOT NULL DEFAULT false,
  last_price_per_unit NUMERIC(14,2),
  unit_id             UUID         REFERENCES units(id),
  notes               TEXT,
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (ingredient_id, vendor_id)
);

CREATE INDEX idx_ingredient_vendors_ingredient ON ingredient_vendors (ingredient_id);
CREATE INDEX idx_ingredient_vendors_vendor     ON ingredient_vendors (vendor_id);

COMMENT ON TABLE ingredient_vendors IS 'Mapping bahan ke vendor. Admin tahu mau order bahan ini ke vendor mana.';


-- ------------------------------------------------------------
-- 4.9 production_processes
-- Mendefinisikan 1 alur transformasi lengkap:
--   raw_ingredient → (beberapa tahap) → output_ingredient (processed)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS production_processes (
  id                   UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  name                 TEXT         NOT NULL,   -- e.g. "Proses ayam berlaris dari ayam utuh"
  raw_ingredient_id    UUID         NOT NULL REFERENCES ingredients(id), -- bahan yang masuk
  output_ingredient_id UUID         NOT NULL REFERENCES ingredients(id), -- porsi yang dihasilkan
  portion_size_g       NUMERIC(10,3),            -- gram per porsi output (untuk single-output)
  is_active            BOOLEAN      NOT NULL DEFAULT true,
  notes                TEXT,
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_prod_processes_updated_at
  BEFORE UPDATE ON production_processes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE production_processes IS '11 proses produksi: raw → processed. Untuk multi-output, gunakan production_outputs.';


-- ------------------------------------------------------------
-- 4.10 production_stages
-- Setiap tahap dalam satu production process
-- Urutan: stage_order = 1, 2, 3...
-- yield_pct: % dari input yang tersisa setelah tahap ini
-- Cumulative yield = PRODUCT of all stage yield_pct / 100
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS production_stages (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  process_id   UUID         NOT NULL REFERENCES production_processes(id) ON DELETE CASCADE,
  stage_order  INTEGER      NOT NULL CHECK (stage_order >= 1),
  stage_name   TEXT         NOT NULL,          -- "Trimming", "Memasak", "Portioning"
  yield_pct    NUMERIC(5,2) NOT NULL CHECK (yield_pct > 0 AND yield_pct <= 100),
  notes        TEXT,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (process_id, stage_order)
);

CREATE INDEX idx_prod_stages_process ON production_stages (process_id);

COMMENT ON TABLE  production_stages          IS 'Tahap-tahap dalam satu production process. Cumulative yield = Π(yield_pct/100).';
COMMENT ON COLUMN production_stages.yield_pct IS 'Persen bahan yang tersisa setelah tahap ini. Contoh: trimming = 85, memasak = 73.';


-- ------------------------------------------------------------
-- 4.11 production_outputs
-- Untuk multi-output: 1 proses menghasilkan beberapa processed ingredient
-- cost_allocation_pct: berapa % biaya dialokasikan ke output ini
-- Total cost_allocation_pct dalam 1 process harus = 100
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS production_outputs (
  id                    UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  process_id            UUID         NOT NULL REFERENCES production_processes(id) ON DELETE CASCADE,
  output_ingredient_id  UUID         NOT NULL REFERENCES ingredients(id),
  output_qty_per_batch  NUMERIC(10,3),           -- expected qty dari 1 batch standar
  unit_id               UUID         NOT NULL REFERENCES units(id),
  cost_allocation_pct   NUMERIC(5,2) NOT NULL DEFAULT 100
                        CHECK (cost_allocation_pct > 0 AND cost_allocation_pct <= 100),
  notes                 TEXT,
  created_at            TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX idx_prod_outputs_process ON production_outputs (process_id);

COMMENT ON TABLE production_outputs IS 'Untuk multi-output: misal 1 ekor ayam → paha, dada, sayap, tulang. cost_allocation_pct total per process harus = 100.';


-- ------------------------------------------------------------
-- 4.12 production_batches
-- Log aktual setiap kali kitchen melakukan produksi
-- Ini data audit harian yang paling kritis
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS production_batches (
  id                    UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  process_id            UUID         NOT NULL REFERENCES production_processes(id),
  batch_date            DATE         NOT NULL DEFAULT CURRENT_DATE,
  raw_qty_used          NUMERIC(10,3) NOT NULL CHECK (raw_qty_used > 0),
  raw_unit_id           UUID         NOT NULL REFERENCES units(id),
  portions_actual       INTEGER      NOT NULL CHECK (portions_actual >= 0),
  portions_theoretical  NUMERIC(10,2),  -- dihitung sistem: raw_qty × cumulative_yield ÷ portion_size
  yield_actual_pct      NUMERIC(5,2),   -- dihitung sistem: portions_actual ÷ portions_theoretical × 100
  variance_pct          NUMERIC(5,2),   -- dihitung sistem: (actual - theoretical) ÷ theoretical × 100
  is_flagged            BOOLEAN      NOT NULL DEFAULT false,
  processed_by          TEXT,           -- nama staff yang produksi
  notes                 TEXT,
  created_by            UUID         REFERENCES users(id),
  created_at            TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX idx_prod_batches_date    ON production_batches (batch_date DESC);
CREATE INDEX idx_prod_batches_process ON production_batches (process_id);
CREATE INDEX idx_prod_batches_flagged ON production_batches (is_flagged) WHERE is_flagged = true;

COMMENT ON TABLE  production_batches                 IS 'Log produksi harian. Bandingkan theoretical vs actual untuk deteksi penyusutan anomali.';
COMMENT ON COLUMN production_batches.is_flagged       IS 'true jika |variance_pct| > threshold (default 5%).';
COMMENT ON COLUMN production_batches.portions_theoretical IS 'Dihitung FastAPI: raw_qty × cumulative_yield ÷ portion_size_g × 1000.';


-- ------------------------------------------------------------
-- 4.13 daily_sales_entries
-- Admin input qty terjual per menu per hari
-- Ini menggantikan iSeller CSV integration
-- UNIQUE(entry_date, menu_id): satu entry per menu per hari
-- Catatan: di v2.0 POS, akan ditambah order_id, table_number, cashier_id
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS daily_sales_entries (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_date  DATE         NOT NULL DEFAULT CURRENT_DATE,
  menu_id     UUID         NOT NULL REFERENCES menu_items(id),
  qty_sold    INTEGER      NOT NULL CHECK (qty_sold >= 0),
  -- POS v2.0 fields (null for now):
  -- order_id     TEXT,
  -- table_number TEXT,
  -- cashier_id   UUID REFERENCES users(id),
  entered_by  UUID         REFERENCES users(id),
  entered_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  notes       TEXT,
  UNIQUE (entry_date, menu_id)
);

CREATE INDEX idx_sales_entries_date    ON daily_sales_entries (entry_date DESC);
CREATE INDEX idx_sales_entries_menu    ON daily_sales_entries (menu_id);

COMMENT ON TABLE  daily_sales_entries IS 'Input penjualan harian oleh admin. Di v2.0 POS: real-time order entry per transaksi.';


-- ------------------------------------------------------------
-- 4.14 daily_stock_opname
-- Hasil hitung fisik stok per bahan per hari
-- Ini ground truth untuk variance calculation
-- UNIQUE(opname_date, ingredient_id): satu count per bahan per hari
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS daily_stock_opname (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  opname_date   DATE         NOT NULL DEFAULT CURRENT_DATE,
  ingredient_id UUID         NOT NULL REFERENCES ingredients(id),
  physical_qty  NUMERIC(10,3) NOT NULL CHECK (physical_qty >= 0),
  unit_id       UUID         NOT NULL REFERENCES units(id),
  counted_by    UUID         REFERENCES users(id),
  counted_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  notes         TEXT,
  UNIQUE (opname_date, ingredient_id)
);

CREATE INDEX idx_opname_date       ON daily_stock_opname (opname_date DESC);
CREATE INDEX idx_opname_ingredient ON daily_stock_opname (ingredient_id);

COMMENT ON TABLE daily_stock_opname IS 'Stok fisik harian per ingredient. Ground truth untuk variance = opname vs theoretical closing.';


-- ------------------------------------------------------------
-- 4.15 theoretical_consumption
-- Hasil kalkulasi FastAPI: berapa bahan yang seharusnya terpakai
-- berdasarkan sales harian × BOM
-- Dihitung ulang setiap kali daily_sales_entries di-submit
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS theoretical_consumption (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  consumption_date DATE         NOT NULL,
  ingredient_id    UUID         NOT NULL REFERENCES ingredients(id),
  consumed_qty     NUMERIC(10,3) NOT NULL CHECK (consumed_qty >= 0),
  unit_id          UUID         NOT NULL REFERENCES units(id),
  calculated_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (consumption_date, ingredient_id)
);

CREATE INDEX idx_theor_cons_date       ON theoretical_consumption (consumption_date DESC);
CREATE INDEX idx_theor_cons_ingredient ON theoretical_consumption (ingredient_id);

COMMENT ON TABLE theoretical_consumption IS 'Konsumsi teoritis per bahan per hari: SUM(qty_sold × recipe_qty per ingredient). Dihitung FastAPI.';


-- ------------------------------------------------------------
-- 4.16 purchase_orders
-- PO lifecycle: draft → sent → partial → received | cancelled
-- po_number di-generate otomatis via function
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS purchase_orders (
  id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  po_number         TEXT         NOT NULL UNIQUE DEFAULT generate_po_number(),
  vendor_id         UUID         NOT NULL REFERENCES vendors(id),
  status            TEXT         NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'sent', 'partial', 'received', 'cancelled')),
  po_date           DATE         NOT NULL DEFAULT CURRENT_DATE,
  expected_delivery DATE,
  actual_delivery   DATE,
  notes             TEXT,
  created_by        UUID         REFERENCES users(id),
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX idx_po_vendor ON purchase_orders (vendor_id);
CREATE INDEX idx_po_status ON purchase_orders (status);
CREATE INDEX idx_po_date   ON purchase_orders (po_date DESC);

CREATE TRIGGER trg_po_updated_at
  BEFORE UPDATE ON purchase_orders
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE  purchase_orders          IS 'Purchase Order header. po_number auto-generated: PO-YYYY-MM-NNN.';
COMMENT ON COLUMN purchase_orders.status   IS 'draft → sent → partial (sebagian diterima) → received | cancelled.';


-- ------------------------------------------------------------
-- 4.17 po_items
-- Detail item dalam setiap PO
-- total_price = generated column: ordered_qty × unit_price
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS po_items (
  id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id         UUID          NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  ingredient_id UUID          NOT NULL REFERENCES ingredients(id),
  ordered_qty   NUMERIC(10,3) NOT NULL CHECK (ordered_qty > 0),
  unit_id       UUID          NOT NULL REFERENCES units(id),
  unit_price    NUMERIC(14,2) NOT NULL CHECK (unit_price >= 0),
  total_price   NUMERIC(14,2) GENERATED ALWAYS AS (ordered_qty * unit_price) STORED,
  notes         TEXT
);

CREATE INDEX idx_po_items_po          ON po_items (po_id);
CREATE INDEX idx_po_items_ingredient  ON po_items (ingredient_id);

COMMENT ON TABLE po_items IS 'Detail item PO. total_price = generated column (ordered_qty × unit_price).';


-- ------------------------------------------------------------
-- 4.18 goods_receipts
-- Konfirmasi penerimaan barang. po_id nullable: bisa terima barang
-- tanpa PO sebelumnya (emergency purchase)
-- Saat status changed ke received → trigger recalculate HPP
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS goods_receipts (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id         UUID         REFERENCES purchase_orders(id), -- nullable: tanpa PO
  received_date DATE         NOT NULL DEFAULT CURRENT_DATE,
  received_by   UUID         REFERENCES users(id),
  notes         TEXT,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX idx_receipts_po   ON goods_receipts (po_id);
CREATE INDEX idx_receipts_date ON goods_receipts (received_date DESC);

COMMENT ON TABLE goods_receipts IS 'Header penerimaan barang. Saat dikonfirmasi → update ingredient_cost_history + recalc avg_cost + recalc HPP.';


-- ------------------------------------------------------------
-- 4.19 receipt_items
-- Detail barang yang benar-benar diterima
-- Bisa berbeda dari PO (qty beda, harga beda)
-- Saat insert → trigger update ingredient_cost_history + avg_cost
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS receipt_items (
  id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id            UUID          NOT NULL REFERENCES goods_receipts(id) ON DELETE CASCADE,
  ingredient_id         UUID          NOT NULL REFERENCES ingredients(id),
  received_qty          NUMERIC(10,3) NOT NULL CHECK (received_qty >= 0),
  unit_id               UUID          NOT NULL REFERENCES units(id),
  actual_price_per_unit NUMERIC(14,2) NOT NULL CHECK (actual_price_per_unit >= 0),
  total_price           NUMERIC(14,2) GENERATED ALWAYS AS (received_qty * actual_price_per_unit) STORED,
  notes                 TEXT
);

CREATE INDEX idx_receipt_items_receipt    ON receipt_items (receipt_id);
CREATE INDEX idx_receipt_items_ingredient ON receipt_items (ingredient_id);

COMMENT ON TABLE receipt_items IS 'Detail barang diterima. Qty dan harga bisa berbeda dari PO. total_price = generated column.';


-- ------------------------------------------------------------
-- 4.20 ingredient_cost_history
-- History harga beli per ingredient dari setiap penerimaan
-- Dipakai untuk kalkulasi weighted average cost
-- avg_cost_snapshot: weighted avg setelah update ini (dihitung FastAPI)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ingredient_cost_history (
  id                 UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  ingredient_id      UUID          NOT NULL REFERENCES ingredients(id),
  receipt_item_id    UUID          REFERENCES receipt_items(id),
  price_per_unit     NUMERIC(14,2) NOT NULL CHECK (price_per_unit >= 0),
  qty_received       NUMERIC(10,3) NOT NULL CHECK (qty_received > 0),
  unit_id            UUID          NOT NULL REFERENCES units(id),
  avg_cost_snapshot  NUMERIC(14,2),  -- weighted avg setelah update ini
  received_at        TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX idx_cost_history_ingredient ON ingredient_cost_history (ingredient_id);
CREATE INDEX idx_cost_history_date       ON ingredient_cost_history (received_at DESC);

COMMENT ON TABLE  ingredient_cost_history              IS 'History harga beli per ingredient. Basis kalkulasi weighted average cost.';
COMMENT ON COLUMN ingredient_cost_history.avg_cost_snapshot IS 'Weighted avg setelah pembelian ini: (old_avg×old_qty + new_price×new_qty) ÷ (old_qty+new_qty).';


-- ------------------------------------------------------------
-- 4.21 menu_hpp
-- Cache HPP per menu per bulan
-- Di-update otomatis saat ada goods_receipt baru yang mengubah avg_cost
-- period_month: first day of month (e.g. 2026-05-01)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS menu_hpp (
  id             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  menu_id        UUID          NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  period_month   DATE          NOT NULL,  -- first day of month
  hpp_amount     NUMERIC(14,2) NOT NULL CHECK (hpp_amount >= 0),
  food_cost_pct  NUMERIC(5,2),            -- hpp ÷ selling_price × 100
  calculated_at  TIMESTAMPTZ   NOT NULL DEFAULT now(),
  UNIQUE (menu_id, period_month)
);

CREATE INDEX idx_menu_hpp_menu   ON menu_hpp (menu_id);
CREATE INDEX idx_menu_hpp_period ON menu_hpp (period_month DESC);

COMMENT ON TABLE  menu_hpp              IS 'HPP per menu per bulan. Di-recalculate saat ada perubahan harga bahan. Cache untuk performa dashboard.';
COMMENT ON COLUMN menu_hpp.food_cost_pct IS 'hpp_amount ÷ selling_price × 100. Target <35%. Flag jika >40%.';


-- ------------------------------------------------------------
-- 4.22 variance_reports
-- Variance harian per ingredient
-- Dihitung setiap malam setelah admin submit opname
-- Formula:
--   theoretical_closing = opening_qty + production_in - theoretical_out
--   variance = actual_closing (opname) - theoretical_closing
--   variance_pct = variance ÷ theoretical_closing × 100
-- Flag jika |variance_pct| > 5%
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS variance_reports (
  id                   UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  report_date          DATE          NOT NULL,
  ingredient_id        UUID          NOT NULL REFERENCES ingredients(id),
  opening_qty          NUMERIC(10,3),  -- dari opname hari sebelumnya
  production_in_qty    NUMERIC(10,3) NOT NULL DEFAULT 0, -- dari production_batches hari ini
  theoretical_out_qty  NUMERIC(10,3) NOT NULL DEFAULT 0, -- dari theoretical_consumption hari ini
  theoretical_closing  NUMERIC(10,3),  -- dihitung: opening + prod_in - theo_out
  actual_closing_qty   NUMERIC(10,3),  -- dari daily_stock_opname hari ini
  variance_qty         NUMERIC(10,3),  -- actual - theoretical
  variance_pct         NUMERIC(5,2),   -- variance ÷ theoretical × 100
  is_flagged           BOOLEAN       NOT NULL DEFAULT false,
  unit_id              UUID          NOT NULL REFERENCES units(id),
  calculated_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
  UNIQUE (report_date, ingredient_id)
);

CREATE INDEX idx_variance_date      ON variance_reports (report_date DESC);
CREATE INDEX idx_variance_flagged   ON variance_reports (is_flagged) WHERE is_flagged = true;
CREATE INDEX idx_variance_ingredient ON variance_reports (ingredient_id);

COMMENT ON TABLE  variance_reports            IS 'Variance harian per ingredient. Core output audit. is_flagged=true jika |variance_pct| > 5%.';
COMMENT ON COLUMN variance_reports.variance_pct IS 'Negatif = lebih banyak yang hilang. Positif = lebih banyak tersisa (mungkin ada sales yg tidak diinput).';


-- ------------------------------------------------------------
-- 4.23 audit_logs
-- Full audit trail: siapa mengubah apa, kapan, nilai sebelum dan sesudah
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_logs (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID         REFERENCES users(id),
  action      TEXT         NOT NULL CHECK (action IN ('INSERT', 'UPDATE', 'DELETE')),
  table_name  TEXT         NOT NULL,
  record_id   UUID,
  old_values  JSONB,
  new_values  JSONB,
  changed_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  ip_address  TEXT
);

CREATE INDEX idx_audit_table   ON audit_logs (table_name);
CREATE INDEX idx_audit_date    ON audit_logs (changed_at DESC);
CREATE INDEX idx_audit_user    ON audit_logs (user_id);
CREATE INDEX idx_audit_record  ON audit_logs (record_id) WHERE record_id IS NOT NULL;

COMMENT ON TABLE audit_logs IS 'Full audit trail. old_values dan new_values di-capture FastAPI sebelum/sesudah setiap perubahan data sensitif.';


-- ============================================================
-- 5. SEED DATA — units
-- ============================================================
INSERT INTO units (name, symbol) VALUES
  ('gram',   'g'),
  ('kilogram','kg'),
  ('ml',     'ml'),
  ('liter',  'L'),
  ('pcs',    'pcs'),
  ('porsi',  'prs'),
  ('botol',  'btl'),
  ('galon',  'gal'),
  ('pack',   'pk'),
  ('pax',    'pax'),
  ('buah',   'bh'),
  ('lembar', 'lbr'),
  ('sachet', 'sct'),
  ('jerigen','jrg'),
  ('ekor',   'ekr')
ON CONFLICT (name) DO NOTHING;


-- ============================================================
-- 6. SEED DATA — unit_conversions
-- Arah: from → to
-- Contoh: 1 kg = 1000 g → from=kg, to=g, factor=1000
-- ============================================================
INSERT INTO unit_conversions (from_unit_id, to_unit_id, factor, notes)
SELECT f.id, t.id, v.factor, v.notes
FROM (VALUES
  ('kilogram', 'gram',    1000,    '1 kg = 1000 g'),
  ('gram',     'kilogram', 0.001,  '1 g = 0.001 kg'),
  ('liter',    'ml',      1000,    '1 L = 1000 ml'),
  ('ml',       'liter',    0.001,  '1 ml = 0.001 L'),
  ('galon',    'liter',   19,      '1 galon Amidis = 19 L'),
  ('galon',    'ml',      19000,   '1 galon = 19000 ml'),
  ('jerigen',  'liter',   18,      '1 jerigen minyak = 18 L'),
  ('jerigen',  'ml',      18000,   '1 jerigen = 18000 ml')
) AS v(from_name, to_name, factor, notes)
JOIN units f ON f.name = v.from_name
JOIN units t ON t.name = v.to_name
ON CONFLICT (from_unit_id, to_unit_id) DO NOTHING;


-- ============================================================
-- 7. SEED DATA — vendors (dari belanja Mei 2026)
-- ============================================================
INSERT INTO vendors (name, contact_name, contact_phone, lead_time_days, payment_terms, notes) VALUES
  ('SAYURANZ',              NULL, NULL, 1, 'COD',     'Sayuran segar harian — frekuensi paling tinggi'),
  ('PT Hulu Bumi Nusantara',NULL, NULL, 1, 'COD',     'Ayam utuh, bebek, daging segar'),
  ('LOTTEGROSIR',           NULL, NULL, 1, 'COD',     'Dry goods, sembako, bumbu kering'),
  ('Ana Crack',             NULL, NULL, 2, 'COD',     'Coffee supplies — beans, sirup, powder'),
  ('Ardha Bakery',          NULL, NULL, 1, 'COD',     'Roti tawar, burger bun, baguette, hotdog bun'),
  ('PT Sukanda Djaya',      NULL, NULL, 2, 'bulanan', 'Mozarella, fresh milk, ice cream premium'),
  ('CV Jaya Utama',         NULL, NULL, 1, 'COD',     'Air mineral Amidis & Aqua galon/botol'),
  ('HAFIZ BERAS',           NULL, NULL, 2, 'COD',     'Beras Cap Jambu 20kg'),
  ('WingsFly (Akbar)',      NULL, NULL, 1, 'COD',     'Dada fillet ayam boneless'),
  ('PT Fajar Gas Mandiri',  NULL, NULL, 3, 'bulanan', 'Gas LPG 50kg — order per 2 tabung'),
  ('CV Mandiri',            NULL, NULL, 1, 'COD',     'Es batu'),
  ('Toko Thalia',           NULL, NULL, 1, 'COD',     'Minuman kaleng, sirup, smoked beef, snack kering'),
  ('SM Food',               NULL, NULL, 2, 'COD',     'French fries beku, produk frozen'),
  ('Farm Sidauruk',         NULL, NULL, 1, 'COD',     'Telur ayam kampung/negeri')
ON CONFLICT DO NOTHING;


-- ============================================================
-- 8. SEED DATA — users awal (ubah password via Supabase Auth)
-- ============================================================
INSERT INTO users (email, name, role) VALUES
  ('admin@berlaris.com', 'Admin Berlaris', 'admin'),
  ('owner@berlaris.com', 'Owner Berlaris', 'owner')
ON CONFLICT (email) DO NOTHING;


-- ============================================================
-- 9. USEFUL VIEWS
-- ============================================================

-- View: menu yang aktif hari ini (termasuk seasonal yang dalam range)
CREATE OR REPLACE VIEW active_menus_today AS
SELECT *
FROM menu_items
WHERE is_active = true
  AND (
    is_seasonal = false
    OR (
      is_seasonal = true
      AND (valid_from IS NULL OR valid_from <= CURRENT_DATE)
      AND (valid_until IS NULL OR valid_until >= CURRENT_DATE)
    )
  )
ORDER BY division, category, name;

COMMENT ON VIEW active_menus_today IS 'Menu yang aktif hari ini. Seasonal menu otomatis masuk/keluar berdasarkan tanggal.';

-- View: flagged variance hari ini
CREATE OR REPLACE VIEW flagged_variance_today AS
SELECT
  vr.report_date,
  i.name            AS ingredient_name,
  i.division,
  u.symbol          AS unit,
  vr.opening_qty,
  vr.production_in_qty,
  vr.theoretical_out_qty,
  vr.theoretical_closing,
  vr.actual_closing_qty,
  vr.variance_qty,
  vr.variance_pct
FROM variance_reports vr
JOIN ingredients i ON i.id = vr.ingredient_id
JOIN units u       ON u.id = vr.unit_id
WHERE vr.report_date = CURRENT_DATE
  AND vr.is_flagged = true
ORDER BY ABS(vr.variance_pct) DESC;

COMMENT ON VIEW flagged_variance_today IS 'Ingredient yang variance-nya >5% hari ini, diurutkan dari selisih terbesar.';

-- View: food cost per menu bulan ini
CREATE OR REPLACE VIEW food_cost_this_month AS
SELECT
  m.name              AS menu_name,
  m.category,
  m.division,
  m.selling_price,
  h.hpp_amount,
  h.food_cost_pct,
  CASE
    WHEN h.food_cost_pct IS NULL     THEN 'unknown'
    WHEN h.food_cost_pct <= 35       THEN 'good'
    WHEN h.food_cost_pct <= 40       THEN 'ok'
    ELSE 'high'
  END AS fc_status
FROM menu_items m
LEFT JOIN menu_hpp h ON h.menu_id = m.id
  AND h.period_month = DATE_TRUNC('month', CURRENT_DATE)::DATE
WHERE m.is_active = true
ORDER BY h.food_cost_pct DESC NULLS LAST;

COMMENT ON VIEW food_cost_this_month IS 'Food cost % semua menu bulan ini. fc_status: good (<35%), ok (35-40%), high (>40%).';


-- ============================================================
-- 10. ROW LEVEL SECURITY (Supabase)
-- Enable RLS di Supabase dashboard atau jalankan di bawah ini
-- ============================================================

-- Enable RLS pada tabel sensitif
ALTER TABLE users                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE ingredients              ENABLE ROW LEVEL SECURITY;
ALTER TABLE menu_items               ENABLE ROW LEVEL SECURITY;
ALTER TABLE recipes                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_sales_entries      ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_stock_opname       ENABLE ROW LEVEL SECURITY;
ALTER TABLE production_batches       ENABLE ROW LEVEL SECURITY;
ALTER TABLE variance_reports         ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_orders          ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs               ENABLE ROW LEVEL SECURITY;

-- Policy dasar: admin bisa semua, owner hanya SELECT
-- Sesuaikan dengan implementasi JWT/auth di FastAPI
-- Contoh policy (aktifkan sesuai kebutuhan):

/*
CREATE POLICY admin_all ON daily_sales_entries
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()::UUID
        AND users.role = 'admin'
        AND users.is_active = true
    )
  );

CREATE POLICY owner_select ON variance_reports
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()::UUID
        AND users.role IN ('admin', 'owner')
        AND users.is_active = true
    )
  );
*/


-- ============================================================
-- DONE
-- ============================================================
-- Summary:
--   23 tables (incl. audit_logs) + 3 views
--   14 vendor seed records
--   15 unit seed records
--   8 unit_conversion seed records
--   2 user seed records
--
-- Next steps:
--   1. Import BOM data via FastAPI bulk-import endpoint
--   2. Input production processes (11 chains dari inventory)
--   3. Input ingredient master (83 bar + 70 kitchen + 6 raw)
--   4. Link ingredients ke vendors (ingredient_vendors)
--   5. Set harga awal di ingredients.avg_cost_per_unit dari data Mei 2026
-- ============================================================
