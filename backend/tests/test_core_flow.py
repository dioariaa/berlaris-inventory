"""
End-to-end test: sales -> consumption -> opname -> variance -> adjustment.

One chained scenario with small round numbers so every assert can be verified
by hand against the formulas in CLAUDE.md.

Runs against the real Supabase database.  All seed data is created at the start
and torn down at the end regardless of pass/fail (autouse fixture).

Separate test at the bottom covers HPP with a 2-stage production chain.
"""
import uuid
from datetime import date, timedelta
from decimal import Decimal

import pytest
from jose import jwt
from fastapi.testclient import TestClient

from app.main import app
from app.config import settings
from app.services.supabase import get_supabase_admin

# ────────────────────────────────────────────────────────────────────────────
# Helpers
# ────────────────────────────────────────────────────────────────────────────

# Use dates in the past to avoid collisions with real operational data
TEST_DATE = "2025-01-15"
PREV_DATE = "2025-01-14"

def _tag() -> str:
    return uuid.uuid4().hex[:8]

def _make_token(user_id: str, role: str = "admin") -> str:
    return jwt.encode(
        {"sub": user_id, "role": role, "email": "test@test.com"},
        settings.jwt_secret,
        algorithm="HS256",
    )


# ────────────────────────────────────────────────────────────────────────────
# Fixture: seed + teardown
# ────────────────────────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def ctx():
    """
    Seed minimal data, yield a dict of ids to the tests, then delete everything.
    """
    db = get_supabase_admin()
    tag = _tag()

    # -- user --
    user = db.table("users").insert({
        "email": f"test-{tag}@e2e.local",
        "name": f"E2E User {tag}",
        "role": "admin",
    }).execute().data[0]
    user_id = user["id"]
    token = _make_token(user_id)
    headers = {"Authorization": f"Bearer {token}"}

    # -- unit (gram) — reuse existing --
    unit_g = db.table("units").select("id").eq("symbol", "g").execute().data
    assert unit_g, "Unit 'g' must exist in DB"
    unit_id = unit_g[0]["id"]

    # -- raw ingredient: "Test Beras E2E" --
    ing = db.table("ingredients").insert({
        "name": f"Test Beras {tag}",
        "ingredient_type": "raw",
        "division": "kitchen",
        "base_unit_id": unit_id,
        "avg_cost_per_unit": 0,
        "min_threshold": 100,
    }).execute().data[0]
    ing_id = ing["id"]

    # -- menu item --
    menu = db.table("menu_items").insert({
        "name": f"Nasi Goreng {tag}",
        "category": "main_course",
        "division": "kitchen",
        "selling_price": 25000,
    }).execute().data[0]
    menu_id = menu["id"]

    # -- recipe: 1 menu uses 200g of the ingredient --
    recipe = db.table("recipes").insert({
        "menu_id": menu_id,
        "ingredient_id": ing_id,
        "qty": 200,
        "unit_id": unit_id,
    }).execute().data[0]
    recipe_id = recipe["id"]

    # ---- HPP test data: processed ingredient with 2-stage chain ----
    # Use avg_cost = 40 /g  (realistic: Rp 40.000/kg = Rp 40/g)
    ing_raw_hpp = db.table("ingredients").insert({
        "name": f"Ayam Utuh {tag}",
        "ingredient_type": "raw",
        "division": "kitchen",
        "base_unit_id": unit_id,
        "avg_cost_per_unit": 40,
    }).execute().data[0]
    ing_raw_hpp_id = ing_raw_hpp["id"]

    ing_proc = db.table("ingredients").insert({
        "name": f"Ayam Suir {tag}",
        "ingredient_type": "processed",
        "division": "kitchen",
        "base_unit_id": unit_id,
        "avg_cost_per_unit": 40,
        "portion_size_g": 20,
    }).execute().data[0]
    ing_proc_id = ing_proc["id"]

    proc = db.table("production_processes").insert({
        "name": f"Proses Ayam {tag}",
        "raw_ingredient_id": ing_raw_hpp_id,
        "output_ingredient_id": ing_proc_id,
        "portion_size_g": 20,
    }).execute().data[0]
    proc_id = proc["id"]

    db.table("production_stages").insert([
        {"process_id": proc_id, "stage_order": 1, "stage_name": "Trimming", "yield_pct": 80},
        {"process_id": proc_id, "stage_order": 2, "stage_name": "Cooking",  "yield_pct": 90},
    ]).execute()

    menu_hpp = db.table("menu_items").insert({
        "name": f"Nasi Ayam {tag}",
        "category": "rice_bowl",
        "division": "kitchen",
        "selling_price": 30000,
    }).execute().data[0]
    menu_hpp_id = menu_hpp["id"]

    recipe_hpp = db.table("recipes").insert({
        "menu_id": menu_hpp_id,
        "ingredient_id": ing_proc_id,
        "qty": 40,
        "unit_id": unit_id,
    }).execute().data[0]
    recipe_hpp_id = recipe_hpp["id"]

    data = dict(
        db=db, tag=tag,
        user_id=user_id, token=token, headers=headers,
        unit_id=unit_id,
        ing_id=ing_id, menu_id=menu_id, recipe_id=recipe_id,
        ing_raw_hpp_id=ing_raw_hpp_id, ing_proc_id=ing_proc_id,
        proc_id=proc_id,
        menu_hpp_id=menu_hpp_id, recipe_hpp_id=recipe_hpp_id,
    )

    yield data

    # ── Teardown ── delete in reverse dependency order
    # Adjustments
    db.table("stock_adjustments").delete().eq("ingredient_id", ing_id).execute()

    # Variance
    db.table("variance_reports").delete().eq("ingredient_id", ing_id).execute()

    # Opname (both dates)
    db.table("daily_stock_opname").delete().eq("ingredient_id", ing_id).execute()

    # Consumption
    db.table("theoretical_consumption").delete().eq("ingredient_id", ing_id).execute()

    # Sales entries
    db.table("daily_sales_entries").delete().eq("menu_id", menu_id).execute()

    # Cost history
    db.table("ingredient_cost_history").delete().eq("ingredient_id", ing_id).execute()

    # Receipt items for this ingredient (get receipt_ids first for header cleanup)
    ri_rows = db.table("receipt_items").select("receipt_id").eq("ingredient_id", ing_id).execute().data
    receipt_ids = list({r["receipt_id"] for r in ri_rows})
    db.table("receipt_items").delete().eq("ingredient_id", ing_id).execute()
    for rid in receipt_ids:
        # Only delete receipt header if it has no other items
        remaining = db.table("receipt_items").select("id", count="exact").eq("receipt_id", rid).execute()
        if (remaining.count or 0) == 0:
            db.table("goods_receipts").delete().eq("id", rid).execute()

    # Recipes
    db.table("recipes").delete().eq("id", recipe_id).execute()
    db.table("recipes").delete().eq("id", recipe_hpp_id).execute()

    # HPP cache
    db.table("menu_hpp").delete().eq("menu_id", menu_id).execute()
    db.table("menu_hpp").delete().eq("menu_id", menu_hpp_id).execute()

    # Menu items
    db.table("menu_items").delete().eq("id", menu_id).execute()
    db.table("menu_items").delete().eq("id", menu_hpp_id).execute()

    # Production chain
    db.table("production_stages").delete().eq("process_id", proc_id).execute()
    db.table("production_processes").delete().eq("id", proc_id).execute()

    # Ingredients
    db.table("ingredients").delete().eq("id", ing_id).execute()
    db.table("ingredients").delete().eq("id", ing_proc_id).execute()
    db.table("ingredients").delete().eq("id", ing_raw_hpp_id).execute()

    # User
    db.table("users").delete().eq("id", user_id).execute()


@pytest.fixture(scope="module")
def api():
    return TestClient(app)


# ────────────────────────────────────────────────────────────────────────────
# The chain
# ────────────────────────────────────────────────────────────────────────────

class TestCoreFlow:
    """
    Steps run in order within a single class.
    pytest-ordering not needed — method names are alpha-sorted by step number.
    """

    # ── Step 1: Goods receipt → avg_cost + current_stock ──────────────────

    def test_step1_goods_receipt(self, api, ctx):
        """
        Receive 1000g at Rp 10/g.
        Expected: avg_cost = 10.0, current_stock = 1000.
        """
        r = api.post("/goods-receipts", json={
            "received_date": TEST_DATE,
            "items": [{
                "ingredient_id": ctx["ing_id"],
                "received_qty": 1000,
                "unit_id": ctx["unit_id"],
                "actual_price_per_unit": 10,
            }],
        }, headers=ctx["headers"])
        assert r.status_code == 201, r.text

        ing = ctx["db"].table("ingredients").select("avg_cost_per_unit").eq("id", ctx["ing_id"]).single().execute().data
        assert float(ing["avg_cost_per_unit"]) == 10.0, (
            f"avg_cost should be 10.0 (first receipt: 1000g @ Rp10/g), got {ing['avg_cost_per_unit']}"
        )

        from app.services.stock_level import get_current_stock
        stock = get_current_stock([ctx["ing_id"]], ctx["db"])
        assert stock[0]["current_stock"] == 1000.0, (
            f"current_stock should be 1000.0 after receipt, got {stock[0]['current_stock']}"
        )

    # ── Step 2: Second receipt → weighted average ────────────────────────

    def test_step2_second_receipt(self, api, ctx):
        """
        Receive another 500g at Rp 20/g.
        Weighted avg = (10*1000 + 20*500) / 1500 = 13.33
        current_stock = 1500
        """
        r = api.post("/goods-receipts", json={
            "received_date": TEST_DATE,
            "items": [{
                "ingredient_id": ctx["ing_id"],
                "received_qty": 500,
                "unit_id": ctx["unit_id"],
                "actual_price_per_unit": 20,
            }],
        }, headers=ctx["headers"])
        assert r.status_code == 201, r.text

        ing = ctx["db"].table("ingredients").select("avg_cost_per_unit").eq("id", ctx["ing_id"]).single().execute().data
        expected_avg = round((10 * 1000 + 20 * 500) / 1500, 2)  # 13.33
        assert float(ing["avg_cost_per_unit"]) == expected_avg, (
            f"weighted avg should be {expected_avg}, got {ing['avg_cost_per_unit']}"
        )

        from app.services.stock_level import get_current_stock
        stock = get_current_stock([ctx["ing_id"]], ctx["db"])
        assert stock[0]["current_stock"] == 1500.0

    # ── Step 3: Sales entry → theoretical consumption ────────────────────

    def test_step3_sales_entry(self, api, ctx):
        """
        Sell 3 portions.  BOM = 200g/portion.
        Expected consumption = 3 * 200 = 600g.
        """
        r = api.post("/sales-entry/", json={
            "entry_date": TEST_DATE,
            "entries": [{
                "menu_id": ctx["menu_id"],
                "qty_sold": 3,
                "entry_type": "sale",
            }],
        }, headers=ctx["headers"])
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["total_porsi"] == 3
        assert body["ingredients_recalculated"] >= 1

        tc = ctx["db"].table("theoretical_consumption").select(
            "consumed_qty"
        ).eq("consumption_date", TEST_DATE).eq(
            "ingredient_id", ctx["ing_id"]
        ).execute().data
        assert len(tc) == 1
        assert float(tc[0]["consumed_qty"]) == 600.0, (
            f"theoretical consumption should be 3 * 200 = 600, got {tc[0]['consumed_qty']}"
        )

    # ── Step 4: current_stock drops by consumption ───────────────────────

    def test_step4_stock_after_sales(self, ctx):
        """current_stock = 1500 (receipts) - 600 (consumption) = 900"""
        from app.services.stock_level import get_current_stock
        stock = get_current_stock([ctx["ing_id"]], ctx["db"])
        assert stock[0]["current_stock"] == 900.0, (
            f"current_stock should be 1500 - 600 = 900, got {stock[0]['current_stock']}"
        )

    # ── Step 5: Opname with intentional variance ─────────────────────────

    def test_step5_opname_and_variance(self, api, ctx):
        """
        opening_qty (prev opname) = 1500
        theoretical_out = 600
        theoretical_closing = 1500 + 0 - 600 - 0 = 900

        actual_closing = 800
        variance_qty = 800 - 900 = -100
        variance_pct = -100 / 900 * 100 = -11.11%
        is_flagged = True (|11.11%| > 5%)
        """
        db = ctx["db"]

        # Seed previous day opname (opening for TEST_DATE)
        db.table("daily_stock_opname").upsert({
            "opname_date": PREV_DATE,
            "ingredient_id": ctx["ing_id"],
            "physical_qty": 1500,
            "unit_id": ctx["unit_id"],
            "counted_by": ctx["user_id"],
        }, on_conflict="opname_date,ingredient_id").execute()

        # Submit today's opname: actual = 800
        r = api.post("/opname/", json={
            "opname_date": TEST_DATE,
            "counts": [{
                "ingredient_id": ctx["ing_id"],
                "physical_qty": 800,
                "unit_id": ctx["unit_id"],
            }],
        }, headers=ctx["headers"])
        assert r.status_code == 200, r.text

        var = db.table("variance_reports").select(
            "opening_qty, theoretical_out_qty, theoretical_closing, "
            "actual_closing_qty, variance_qty, variance_pct, is_flagged"
        ).eq("report_date", TEST_DATE).eq(
            "ingredient_id", ctx["ing_id"]
        ).execute().data
        assert len(var) == 1
        v = var[0]

        assert float(v["opening_qty"]) == 1500.0
        assert float(v["theoretical_out_qty"]) == 600.0
        assert float(v["theoretical_closing"]) == 900.0
        assert float(v["actual_closing_qty"]) == 800.0
        assert float(v["variance_qty"]) == -100.0

        expected_pct = round(-100 / 900 * 100, 2)  # -11.11
        assert float(v["variance_pct"]) == expected_pct, (
            f"variance_pct should be {expected_pct}, got {v['variance_pct']}"
        )
        assert v["is_flagged"] is True, "should be flagged (|11.11%| > 5%)"

    # ── Step 6: Adjustment + idempotent check ────────────────────────────

    def test_step6_adjustment(self, api, ctx):
        """
        delta = actual - theoretical = 800 - 900 = -100
        current_stock before: 900
        current_stock after:  900 + (-100) = 800
        Second call → 409
        """
        db = ctx["db"]
        from app.services.stock_level import get_current_stock

        stock_before = get_current_stock([ctx["ing_id"]], db)
        assert stock_before[0]["current_stock"] == 900.0

        opname = db.table("daily_stock_opname").select("id").eq(
            "opname_date", TEST_DATE
        ).eq("ingredient_id", ctx["ing_id"]).execute().data
        opname_id = opname[0]["id"]

        # First adjust
        r = api.post(f"/opname/{opname_id}/adjust", json={
            "reason": "E2E test adjustment",
        }, headers=ctx["headers"])
        assert r.status_code == 200, r.text
        body = r.json()
        assert float(body["qty_delta"]) == -100.0

        stock_after = get_current_stock([ctx["ing_id"]], db)
        assert stock_after[0]["current_stock"] == 800.0, (
            f"post-adjustment stock should be 800, got {stock_after[0]['current_stock']}"
        )
        assert stock_after[0]["adjustments_total"] == -100.0

        # Second adjust → 409
        r2 = api.post(f"/opname/{opname_id}/adjust", json={
            "reason": "duplicate attempt",
        }, headers=ctx["headers"])
        assert r2.status_code == 409, (
            f"duplicate should return 409, got {r2.status_code}: {r2.text}"
        )


# ────────────────────────────────────────────────────────────────────────────
# HPP with multi-stage yield
# ────────────────────────────────────────────────────────────────────────────

class TestHPPChain:
    """
    Processed ingredient through 2-stage production.

    Setup (fixture):
      Raw "Ayam Utuh": avg_cost = 40/g (= Rp 40.000/kg)
      Production: Trimming 80% -> Cooking 90%
      Processed "Ayam Suir": avg_cost = 40/g (same, before yield adjustment)
      Menu "Nasi Ayam": 40g Ayam Suir, selling_price = 30000

    Expected:
      cumulative_yield = 0.8 * 0.9 = 0.72
      effective_cost = 40 / 0.72 = 55.5556/g
      hpp = 40g * 55.5556 = 2222.22
      food_cost_pct = 2222.22 / 30000 * 100 = 7.41%
    """

    def test_hpp_with_yield(self, ctx):
        from app.services.yield_calc import get_cumulative_yield
        from app.services.hpp import recalc_hpp

        db = ctx["db"]

        # 1. Verify cumulative yield
        cy = get_cumulative_yield(ctx["proc_id"], db)
        expected_yield = 0.8 * 0.9  # 0.72
        assert abs(cy - expected_yield) < 0.0001, (
            f"cumulative_yield should be {expected_yield}, got {cy}"
        )

        # 2. Recalc HPP
        result = recalc_hpp(ctx["menu_hpp_id"], client=db)

        # 3. Verify effective_cost in breakdown
        breakdown = result["ingredient_breakdown"]
        assert len(breakdown) == 1
        b = breakdown[0]

        avg_cost = 40.0
        expected_effective = avg_cost / expected_yield  # 55.5556
        assert abs(b["effective_cost"] - expected_effective) < 0.01, (
            f"effective_cost should be {expected_effective:.4f} "
            f"(avg_cost / yield = {avg_cost}/{expected_yield}), "
            f"got {b['effective_cost']}"
        )

        # 4. Verify total HPP = recipe_qty * effective_cost
        recipe_qty = 40.0
        expected_hpp = recipe_qty * expected_effective  # 2222.22
        assert abs(result["hpp"] - expected_hpp) < 0.01, (
            f"hpp should be {expected_hpp:.2f}, got {result['hpp']}"
        )

        # 5. Verify food_cost_pct = hpp / selling_price * 100
        selling = 30000.0
        expected_fc = expected_hpp / selling * 100  # 7.41
        assert abs(result["food_cost_pct"] - expected_fc) < 0.01, (
            f"food_cost_pct should be {expected_fc:.2f}%, got {result['food_cost_pct']}"
        )
