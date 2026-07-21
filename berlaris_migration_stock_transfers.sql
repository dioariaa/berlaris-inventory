-- Migration: stock_transfers (Storage vs Division split, 2026-07-02)
-- Jalankan SEKALI di Supabase SQL Editor.
--
-- Lokasi movement lain TIDAK butuh kolom baru — di-derive by rule di
-- services/stock_level.py:
--   receipts → storage, production/consumption/waste → division ingredient.
-- Tabel ini satu-satunya schema change yang dibutuhkan.

CREATE TABLE IF NOT EXISTS stock_transfers (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ingredient_id UUID NOT NULL REFERENCES ingredients(id),
    qty           NUMERIC NOT NULL CHECK (qty > 0),  -- dalam base unit ingredient
    from_location TEXT NOT NULL CHECK (from_location IN ('storage','bar','kitchen','staff_meal','operational')),
    to_location   TEXT NOT NULL CHECK (to_location   IN ('storage','bar','kitchen','staff_meal','operational')),
    transfer_date DATE NOT NULL DEFAULT CURRENT_DATE,
    notes         TEXT,
    created_by    UUID REFERENCES users(id),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (from_location <> to_location)
);

CREATE INDEX IF NOT EXISTS idx_stock_transfers_ingredient ON stock_transfers(ingredient_id);
CREATE INDEX IF NOT EXISTS idx_stock_transfers_date       ON stock_transfers(transfer_date);
