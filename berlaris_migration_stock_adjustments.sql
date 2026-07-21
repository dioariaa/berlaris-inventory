-- ============================================================
-- Migration: Add stock_adjustments table for ledger reconciliation
-- Allows explicit reconcile ledger ↔ opname with audit trail
-- ============================================================

-- Table: stock_adjustments
-- Stores manual adjustments to correct ledger discrepancies
CREATE TABLE IF NOT EXISTS stock_adjustments (
  id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  ingredient_id UUID        NOT NULL REFERENCES ingredients(id),
  qty_delta    NUMERIC(10,3) NOT NULL, -- can be negative
  reason       TEXT         NOT NULL,  -- required, no default, no empty string
  opname_id    UUID,                   -- FK to daily_stock_opname, nullable (null = manual adjustment outside opname)
  created_by   UUID         NOT NULL REFERENCES users(id),
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  FOREIGN KEY (opname_id) REFERENCES daily_stock_opname(id) ON DELETE SET NULL
);

-- Index: fast lookup by ingredient, opname, created date
CREATE INDEX idx_stock_adjustments_ingredient ON stock_adjustments(ingredient_id);
CREATE INDEX idx_stock_adjustments_opname ON stock_adjustments(opname_id) WHERE opname_id IS NOT NULL;
CREATE INDEX idx_stock_adjustments_created ON stock_adjustments(created_at DESC);

-- Unique constraint: opname_id can have at most 1 adjustment (idempotent)
-- null opname_id allowed (manual adjustments), but if opname_id is NOT null, it's unique
CREATE UNIQUE INDEX uq_stock_adjustments_opname
  ON stock_adjustments(opname_id)
  WHERE opname_id IS NOT NULL;

COMMENT ON TABLE stock_adjustments IS 'Manual adjustments to ledger for reconciliation. Audit trail for corrections linked to opname or standalone.';
COMMENT ON COLUMN stock_adjustments.qty_delta IS 'Quantity to add (positive) or subtract (negative) from ledger.';
COMMENT ON COLUMN stock_adjustments.reason IS 'Required reason for adjustment (no empty strings).';
COMMENT ON COLUMN stock_adjustments.opname_id IS 'Link to opname if adjustment triggered by variance; NULL if manual adjustment.';
