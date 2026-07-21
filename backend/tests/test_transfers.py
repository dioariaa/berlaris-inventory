"""
Self-check: Storage/Division split + guard stok negatif.

Skenario:
  1. Purchase masuk storage, transfer sebagian ke kitchen -> storage berkurang,
     kitchen bertambah tepat sesuai qty; ingredient lain tetap 0 di kitchen.
  2. 4 reject (sales, production, waste, transfer) dengan stok kurang ->
     InsufficientStockError dan TIDAK ADA row yang keinsert.
  3. Adjustment yang bikin stok negatif -> BERHASIL (exclude disengaja).

Butuh migration berlaris_migration_stock_transfers.sql sudah dijalankan.
Jalankan: python -m tests.test_transfers  (dari folder backend/)
"""
from datetime import date

from app.services.supabase import get_supabase_admin
from app.services.stock_level import get_current_stock
from app.services.stock_guard import InsufficientStockError

client = get_supabase_admin()

TEST_DATE = "2020-01-01"  # tanggal unik supaya tidak bentrok data nyata


def _unit_id(symbol):
    return client.table("units").select("id").eq("symbol", symbol).execute().data[0]["id"]


def _locs(iid):
    return get_current_stock([iid])[0]["locations"]


def _expect_reject(fn, *args):
    try:
        fn(*args)
    except InsufficientStockError:
        return
    raise AssertionError(f"{getattr(fn, '__name__', fn)} harusnya reject (InsufficientStockError)")


def main():
    try:
        client.table("stock_transfers").select("id").limit(1).execute()
    except Exception:
        raise SystemExit(
            "TABEL stock_transfers BELUM ADA — jalankan berlaris_migration_stock_transfers.sql "
            "di Supabase SQL Editor dulu."
        )

    from app.routers.transfers import create_transfer, TransferCreate
    from app.routers.waste import log_waste, WasteCreate
    from app.routers.production import create_batch
    from app.routers.sales_entry import submit_sales_entry
    from app.models.production import BatchCreate
    from app.models.sales_entry import SalesEntrySubmit, SalesEntryItem

    gram, kg = _unit_id("g"), _unit_id("kg")
    uid = client.table("users").select("id").limit(1).execute().data[0]["id"]
    user = {"id": uid, "sub": uid}
    cleanup = []
    try:
        # ── Setup: 2 ingredient kitchen, A dapat 1000 g di storage ───────────
        ing_a = client.table("ingredients").insert({
            "name": "__TEST Guard A", "ingredient_type": "raw", "division": "kitchen",
            "base_unit_id": gram,
        }).execute().data[0]
        ing_b = client.table("ingredients").insert({
            "name": "__TEST Guard B", "ingredient_type": "raw", "division": "kitchen",
            "base_unit_id": gram,
        }).execute().data[0]
        cleanup += [("ingredients", ing_a["id"]), ("ingredients", ing_b["id"])]

        receipt = client.table("goods_receipts").insert({
            "received_date": date.today().isoformat(), "received_by": uid,
            "notes": "__TEST purchase",
        }).execute().data[0]
        cleanup.insert(0, ("goods_receipts", receipt["id"]))
        item = client.table("receipt_items").insert({
            "receipt_id": receipt["id"], "ingredient_id": ing_a["id"],
            "received_qty": 1000, "unit_id": gram, "actual_price_per_unit": 10,
        }).execute().data[0]
        cleanup.insert(0, ("receipt_items", item["id"]))

        # ── 1. Transfer valid: 300 storage -> kitchen ─────────────────────────
        try:
            tr = create_transfer(TransferCreate(
                ingredient_id=ing_a["id"], qty=300,
                from_location="storage_kitchen", to_location="kitchen",
            ), user)
        except Exception as e:
            if "check constraint" in str(e):
                raise SystemExit(
                    "CHECK constraint lokasi masih versi lama - jalankan "
                    "berlaris_migration_storage_split.sql di Supabase SQL Editor dulu."
                )
            raise
        cleanup.insert(0, ("stock_transfers", tr["id"]))

        a = _locs(ing_a["id"])
        b = _locs(ing_b["id"])
        assert a["storage_kitchen"] == 700, f"storage_kitchen A harus 700, dapat {a}"
        assert a["kitchen"] == 300, f"kitchen A harus 300, dapat {a}"
        assert b["kitchen"] == 0,   f"kitchen B harus 0, dapat {b}"
        print("PASS 1: purchase->storage_kitchen 1000, transfer 300->kitchen, B tetap 0")

        # ── 2a. Transfer reject: 800 > 700 di storage ────────────────────────
        _expect_reject(create_transfer, TransferCreate(
            ingredient_id=ing_a["id"], qty=800,
            from_location="storage_kitchen", to_location="kitchen",
        ), user)
        n_tr = client.table("stock_transfers").select("id", count="exact").eq(
            "ingredient_id", ing_a["id"]).execute().count
        assert n_tr == 1, f"transfer reject tetap keinsert! count={n_tr}"
        print("PASS 2a: transfer reject, tidak ada row baru")

        # ── 2b. Waste reject: 400 > 300 di kitchen ───────────────────────────
        _expect_reject(log_waste, WasteCreate(
            ingredient_id=ing_a["id"], qty=400, unit_id=gram, reason="spoiled",
        ), user)
        n_w = client.table("waste_logs").select("id", count="exact").eq(
            "ingredient_id", ing_a["id"]).execute().count
        assert n_w == 0, f"waste reject tetap keinsert! count={n_w}"
        print("PASS 2b: waste reject, tidak ada row")

        # ── 2c. Production reject: butuh 1 kg = 1000 g > 300 di kitchen ─────
        out = client.table("ingredients").insert({
            "name": "__TEST Guard Out", "ingredient_type": "processed",
            "division": "kitchen", "base_unit_id": gram, "portion_size_g": 100,
        }).execute().data[0]
        cleanup.insert(0, ("ingredients", out["id"]))
        proc = client.table("production_processes").insert({
            "name": "__TEST proses guard", "raw_ingredient_id": ing_a["id"],
            "output_ingredient_id": out["id"], "portion_size_g": 100,
        }).execute().data[0]
        cleanup.insert(0, ("production_processes", proc["id"]))

        _expect_reject(create_batch, BatchCreate(
            process_id=proc["id"], batch_date=date.today(),
            raw_qty_used=1, raw_unit_id=kg, portions_actual=3,
        ), user)
        n_b = client.table("production_batches").select("id", count="exact").eq(
            "process_id", proc["id"]).execute().count
        assert n_b == 0, f"batch reject tetap keinsert! count={n_b}"
        print("PASS 2c: production reject, tidak ada row")

        # ── 2d. Sales reject: resep butuh 400 g/porsi > 300 di kitchen ──────
        menu = client.table("menu_items").insert({
            "name": "__TEST Menu Guard", "category": "other", "division": "kitchen",
            "selling_price": 10000,
        }).execute().data[0]
        cleanup.insert(0, ("menu_items", menu["id"]))
        recipe = client.table("recipes").insert({
            "menu_id": menu["id"], "ingredient_id": ing_a["id"],
            "qty": 400, "unit_id": gram,
        }).execute().data[0]
        cleanup.insert(0, ("recipes", recipe["id"]))

        _expect_reject(submit_sales_entry, SalesEntrySubmit(
            entry_date=date.fromisoformat(TEST_DATE),
            entries=[SalesEntryItem(menu_id=menu["id"], qty_sold=1)],
        ), user)
        n_s = client.table("daily_sales_entries").select("id", count="exact").eq(
            "entry_date", TEST_DATE).execute().count
        n_c = client.table("theoretical_consumption").select("id", count="exact").eq(
            "consumption_date", TEST_DATE).execute().count
        assert n_s == 0, f"sales entry reject tetap keinsert! count={n_s}"
        assert n_c == 0, f"consumption reject tetap keinsert! count={n_c}"
        print("PASS 2d: sales reject, entries di-rollback, tidak ada consumption")

        # ── 3. Adjustment boleh bikin negatif (exclude disengaja) ────────────
        adj = client.table("stock_adjustments").insert({
            "ingredient_id": ing_b["id"], "qty_delta": -50,
            "reason": "__TEST koreksi opname", "created_by": uid,
        }).execute().data[0]
        cleanup.insert(0, ("stock_adjustments", adj["id"]))
        b = get_current_stock([ing_b["id"]])[0]
        assert b["current_stock"] == -50, f"adjustment negatif harus tembus, dapat {b['current_stock']}"
        print("PASS 3: adjustment -50 tembus, stok B = -50")

        print("ALL PASS")
    finally:
        for table, rid in cleanup:
            client.table(table).delete().eq("id", rid).execute()


if __name__ == "__main__":
    main()
