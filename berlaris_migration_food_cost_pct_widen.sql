-- Widen food_cost_pct from NUMERIC(5,2) to NUMERIC(7,2)
-- Reason: menus with placeholder selling_price=1 cause overflow when
-- food_cost_pct = hpp / 1 * 100 exceeds 999.99
-- Max after fix: 99999.99 — enough for any placeholder scenario
ALTER TABLE menu_hpp ALTER COLUMN food_cost_pct TYPE NUMERIC(7,2);
ALTER TABLE variance_reports ALTER COLUMN variance_pct TYPE NUMERIC(7,2);
