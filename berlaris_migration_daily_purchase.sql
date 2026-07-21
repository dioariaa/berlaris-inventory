-- ============================================================
-- MIGRATION: Daily Purchase Entry
-- Jalankan di Supabase SQL Editor (project: xvzujceymyozqztdongm)
-- ============================================================

-- 1. goods_receipts: payment tracking
ALTER TABLE goods_receipts
  ADD COLUMN IF NOT EXISTS payment_date   DATE,
  ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'unpaid'
    CHECK (payment_status IN ('unpaid', 'paid'));

-- 2. receipt_items: per-item category dan vendor
ALTER TABLE receipt_items
  ADD COLUMN IF NOT EXISTS po_category TEXT
    CHECK (po_category IN ('kitchen', 'bar', 'staff_meal', 'operational')),
  ADD COLUMN IF NOT EXISTS vendor_id UUID REFERENCES vendors(id);

CREATE INDEX IF NOT EXISTS idx_receipt_items_vendor   ON receipt_items (vendor_id);
CREATE INDEX IF NOT EXISTS idx_receipt_items_category ON receipt_items (po_category);

-- Verifikasi
SELECT column_name, data_type, column_default, is_nullable
FROM information_schema.columns
WHERE table_name IN ('goods_receipts', 'receipt_items')
  AND column_name IN ('payment_date', 'payment_status', 'po_category', 'vendor_id')
ORDER BY table_name, column_name;
