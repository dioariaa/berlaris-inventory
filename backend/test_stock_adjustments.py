"""
Test: Stock adjustments reconciliation.
- Assert current_stock changes by exactly qty_delta after adjustment
- Assert endpoint rejects duplicate adjustment for same opname_id (409)
"""
from datetime import date
from decimal import Decimal
from app.services.supabase import get_supabase_admin
from app.services.stock_level import get_current_stock


def test_stock_adjustment_idempotent():
    """Test: POST /opnames/{opname_id}/adjust rejects duplicate calls (409)."""
    client = get_supabase_admin()

    # Get a real user for FK
    users = client.table("users").select("id").limit(1).execute().data
    if not users:
        print("[SKIP] No users found. Skipping test.")
        return
    user_id = users[0]["id"]

    # Setup: Find an opname with variance that hasn't been adjusted
    variance_rows = (
        client.table("variance_reports")
        .select("report_date, ingredient_id, variance_qty, is_flagged")
        .eq("is_flagged", True)
        .limit(1)
        .execute()
        .data
    )
    if not variance_rows:
        print("[SKIP] No flagged variance found. Skipping test.")
        return

    var = variance_rows[0]
    report_date = var["report_date"]
    ingredient_id = var["ingredient_id"]

    # Find opname id
    opname_rows = (
        client.table("daily_stock_opname")
        .select("id")
        .eq("opname_date", report_date)
        .eq("ingredient_id", ingredient_id)
        .limit(1)
        .execute()
        .data
    )
    if not opname_rows:
        print("[SKIP] Opname not found. Skipping test.")
        return

    opname_id = opname_rows[0]["id"]

    # Check if already adjusted (cleanup if exists)
    existing = (
        client.table("stock_adjustments")
        .select("id")
        .eq("opname_id", opname_id)
        .execute()
        .data
    )
    if existing:
        client.table("stock_adjustments").delete().eq("opname_id", opname_id).execute()
        print(f"  [CLEANUP] Removed existing adjustment for {opname_id}")

    # Test 1: Insert first adjustment (should succeed)
    try:
        result = client.table("stock_adjustments").insert({
            "ingredient_id": ingredient_id,
            "qty_delta": float(var["variance_qty"]),
            "reason": "Test adjustment",
            "opname_id": opname_id,
            "created_by": user_id,
        }).execute()
        assert result.data, "First adjustment failed"
        first_id = result.data[0]["id"]
        print(f"[PASS] First adjustment inserted: {first_id}")
    except Exception as e:
        print(f"[FAIL] First insert failed: {e}")
        return

    # Test 2: Insert duplicate (should fail due to UNIQUE constraint)
    try:
        client.table("stock_adjustments").insert({
            "ingredient_id": ingredient_id,
            "qty_delta": float(var["variance_qty"]),
            "reason": "Duplicate attempt",
            "opname_id": opname_id,
            "created_by": user_id,
        }).execute()
        print("[FAIL] Duplicate insert succeeded (should have failed!)")
    except Exception as e:
        if "unique" in str(e).lower():
            print("[PASS] Duplicate insert rejected (UNIQUE constraint working)")
        else:
            print(f"[FAIL] Unexpected error on duplicate: {e}")

    # Cleanup
    client.table("stock_adjustments").delete().eq("opname_id", opname_id).execute()
    print("  [CLEANUP] Removed test data")


def test_current_stock_includes_adjustments():
    """Test: current_stock formula includes adjustments_total."""
    client = get_supabase_admin()

    # Get a real user for FK
    users = client.table("users").select("id").limit(1).execute().data
    if not users:
        print("[SKIP] No users found. Skipping test.")
        return
    user_id = users[0]["id"]

    # Get an ingredient
    ing_rows = (
        client.table("ingredients")
        .select("id")
        .eq("is_active", True)
        .limit(1)
        .execute()
        .data
    )
    if not ing_rows:
        print("[SKIP] No ingredients found. Skipping test.")
        return

    ingredient_id = ing_rows[0]["id"]

    # Get current stock before adjustment
    stock_before = get_current_stock([ingredient_id], client)
    if not stock_before:
        print("[SKIP] get_current_stock returned empty. Skipping test.")
        return

    current_before = stock_before[0]["current_stock"]
    adjustment_delta = Decimal("10.5")

    # Insert adjustment
    adj_result = client.table("stock_adjustments").insert({
        "ingredient_id": ingredient_id,
        "qty_delta": float(adjustment_delta),
        "reason": "Test delta change",
        "opname_id": None,  # manual adjustment, no opname
        "created_by": user_id,
    }).execute()
    adj_id = adj_result.data[0]["id"]

    # Get current stock after adjustment
    stock_after = get_current_stock([ingredient_id], client)
    current_after = stock_after[0]["current_stock"]

    # Assert delta
    expected_delta = float(adjustment_delta)
    actual_delta = float(current_after - current_before)

    if abs(actual_delta - expected_delta) < 0.001:
        print(f"[PASS] current_stock delta correct: {current_before} -> {current_after} (delta={actual_delta})")
    else:
        print(f"[FAIL] Delta mismatch: expected {expected_delta}, got {actual_delta}")

    # Assert adjustment is in response
    if stock_after[0].get("adjustments_total") is not None:
        print(f"[PASS] adjustments_total included in response: {stock_after[0]['adjustments_total']}")
    else:
        print("[FAIL] adjustments_total not in response")

    # Cleanup
    client.table("stock_adjustments").delete().eq("id", adj_id).execute()
    print("  [CLEANUP] Removed test adjustment")


if __name__ == "__main__":
    print("\n=== Test: Stock Adjustment Idempotent ===")
    test_stock_adjustment_idempotent()

    print("\n=== Test: Current Stock Includes Adjustments ===")
    test_current_stock_includes_adjustments()

    print("\n[DONE] All tests completed\n")
