"""
Full-system smoke test: 1 hari operasional lengkap, purchase -> variance.

Chain (urut, tiap step tergantung state step sebelumnya):
  receipt -> transfer -> production -> sales -> waste -> opname -> adjust
  -> variance -> dashboard -> cross-location isolation
Plus 4 negative-stock-guard rejects (transfer/production/sales/waste)
yang harus 400 TANPA row nyangkut.

Runs against the real Supabase database (project convention — PostgREST tidak
punya transaksi, jadi isolasi via seed unik + teardown, bukan rollback).
Jalankan: pytest tests/test_full_smoke.py -v   (dari folder backend/)
"""
import uuid
from datetime import date

import pytest
from jose import jwt
from fastapi.testclient import TestClient

from app.main import app
from app.config import settings
from app.services.supabase import get_supabase_admin
from app.services.stock_level import get_current_stock

# Tanggal masa lalu supaya tidak bentrok data operasional nyata
TEST_DATE = "2025-02-10"
PREV_DATE = "2025-02-09"

PASSED: list[str] = []  # untuk summary print di akhir


def _make_token(user_id: str) -> str:
    return jwt.encode(
        {"sub": user_id, "role": "admin", "email": "smoke@test.local"},
        settings.jwt_secret,
        algorithm="HS256",
    )


def _row(ing_id: str) -> dict:
    return get_current_stock([ing_id])[0]


def _locs(ing_id: str) -> dict:
    return _row(ing_id)["locations"]


# ────────────────────────────────────────────────────────────────────────────
# Seed + teardown
# ────────────────────────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def ctx():
    db = get_supabase_admin()
    tag = uuid.uuid4().hex[:8]

    user = db.table("users").insert({
        "email": f"smoke-{tag}@e2e.local", "name": f"Smoke {tag}", "role": "admin",
    }).execute().data[0]
    headers = {"Authorization": f"Bearer {_make_token(user['id'])}"}

    unit_g = db.table("units").select("id").eq("symbol", "g").execute().data
    unit_ml = db.table("units").select("id").eq("symbol", "ml").execute().data
    assert unit_g and unit_ml, "Unit 'g' dan 'ml' harus ada di DB"
    g_id, ml_id = unit_g[0]["id"], unit_ml[0]["id"]

    ing_a = db.table("ingredients").insert({
        "name": f"__SMOKE Raw Kitchen {tag}", "ingredient_type": "raw",
        "division": "kitchen", "base_unit_id": g_id,
    }).execute().data[0]
    ing_b = db.table("ingredients").insert({
        "name": f"__SMOKE Raw Bar {tag}", "ingredient_type": "raw",
        "division": "bar", "base_unit_id": ml_id,
    }).execute().data[0]
    ing_c = db.table("ingredients").insert({
        "name": f"__SMOKE Processed {tag}", "ingredient_type": "processed",
        "division": "kitchen", "base_unit_id": g_id, "portion_size_g": 100,
    }).execute().data[0]

    proc = db.table("production_processes").insert({
        "name": f"__SMOKE Proses {tag}",
        "raw_ingredient_id": ing_a["id"],
        "output_ingredient_id": ing_c["id"],
        "portion_size_g": 100,
    }).execute().data[0]

    menu = db.table("menu_items").insert({
        "name": f"__SMOKE Menu {tag}", "category": "main_course",
        "division": "kitchen", "selling_price": 25000,
    }).execute().data[0]
    # BOM pakai ketiganya: 100g A + 50ml B + 100g C per porsi
    db.table("recipes").insert([
        {"menu_id": menu["id"], "ingredient_id": ing_a["id"], "qty": 100, "unit_id": g_id},
        {"menu_id": menu["id"], "ingredient_id": ing_b["id"], "qty": 50,  "unit_id": ml_id},
        {"menu_id": menu["id"], "ingredient_id": ing_c["id"], "qty": 100, "unit_id": g_id},
    ]).execute()

    data = dict(
        db=db, headers=headers, user_id=user["id"],
        g=g_id, ml=ml_id,
        a=ing_a["id"], b=ing_b["id"], c=ing_c["id"],
        proc=proc["id"], menu=menu["id"],
    )
    yield data

    # ── Teardown (reverse dependency order) ──
    ing_ids = [ing_a["id"], ing_b["id"], ing_c["id"]]
    for t in ("stock_adjustments", "variance_reports", "daily_stock_opname",
              "waste_logs", "theoretical_consumption", "stock_transfers",
              "ingredient_cost_history"):
        db.table(t).delete().in_("ingredient_id", ing_ids).execute()
    db.table("daily_sales_entries").delete().eq("menu_id", menu["id"]).execute()
    db.table("production_batches").delete().eq("process_id", proc["id"]).execute()

    ri = db.table("receipt_items").select("receipt_id").in_("ingredient_id", ing_ids).execute().data
    db.table("receipt_items").delete().in_("ingredient_id", ing_ids).execute()
    for rid in {r["receipt_id"] for r in ri}:
        left = db.table("receipt_items").select("id", count="exact").eq("receipt_id", rid).execute()
        if (left.count or 0) == 0:
            db.table("goods_receipts").delete().eq("id", rid).execute()

    db.table("recipes").delete().eq("menu_id", menu["id"]).execute()
    db.table("menu_hpp").delete().eq("menu_id", menu["id"]).execute()
    db.table("menu_items").delete().eq("id", menu["id"]).execute()
    db.table("production_stages").delete().eq("process_id", proc["id"]).execute()
    db.table("production_processes").delete().eq("id", proc["id"]).execute()
    db.table("ingredients").delete().in_("id", ing_ids).execute()
    db.table("users").delete().eq("id", user["id"]).execute()

    print(f"\n=== SMOKE SUMMARY: {len(PASSED)} step PASS ===")
    for p in PASSED:
        print(f"  PASS {p}")
    if len(PASSED) == 13:
        print("=== SEMUA STEP PASS — SISTEM SIAP UNTUK OPNAME 5 JULI ===")


@pytest.fixture(scope="module")
def api():
    return TestClient(app)


# ────────────────────────────────────────────────────────────────────────────
# Scenario — method names alpha-sorted by step number, run in order
# ────────────────────────────────────────────────────────────────────────────

class TestFullSmoke:

    # 1 ── Purchase masuk storage ------------------------------------------
    def test_step01_purchase_to_storage(self, api, ctx):
        for ing, qty, unit, price in ((ctx["a"], 5000, ctx["g"], 10),
                                      (ctx["b"], 2000, ctx["ml"], 5)):
            r = api.post("/goods-receipts", json={
                "received_date": TEST_DATE,
                "items": [{"ingredient_id": ing, "received_qty": qty,
                           "unit_id": unit, "actual_price_per_unit": price}],
            }, headers=ctx["headers"])
            assert r.status_code == 201, f"receipt gagal: {r.text}"

        a, b = _locs(ctx["a"]), _locs(ctx["b"])
        assert a["storage_kitchen"] == 5000, f"A storage_kitchen harus 5000, dapat {a}"
        assert b["storage_bar"] == 2000, f"B storage_bar harus 2000, dapat {b}"

        db = ctx["db"]
        cost_a = float(db.table("ingredients").select("avg_cost_per_unit")
                       .eq("id", ctx["a"]).single().execute().data["avg_cost_per_unit"])
        cost_b = float(db.table("ingredients").select("avg_cost_per_unit")
                       .eq("id", ctx["b"]).single().execute().data["avg_cost_per_unit"])
        assert cost_a == 10.0, f"avg_cost A harus 10, dapat {cost_a}"
        assert cost_b == 5.0, f"avg_cost B harus 5, dapat {cost_b}"
        PASSED.append("1: purchase -> storage + avg_cost")

    # 2 ── Transfer storage -> division ------------------------------------
    def test_step02_transfer(self, api, ctx):
        for ing, qty, frm, to in ((ctx["a"], 3000, "storage_kitchen", "kitchen"),
                                  (ctx["b"], 1000, "storage_bar", "bar")):
            r = api.post("/transfers", json={
                "ingredient_id": ing, "qty": qty,
                "from_location": frm, "to_location": to,
                "transfer_date": TEST_DATE,
            }, headers=ctx["headers"])
            assert r.status_code == 201, f"transfer gagal: {r.text}"

        a, b = _locs(ctx["a"]), _locs(ctx["b"])
        assert a["storage_kitchen"] == 2000, f"A storage harus 2000, dapat {a}"
        assert a["kitchen"] == 3000, f"A kitchen harus 3000, dapat {a}"
        assert b["storage_bar"] == 1000, f"B storage harus 1000, dapat {b}"
        assert b["bar"] == 1000, f"B bar harus 1000, dapat {b}"
        PASSED.append("2: transfer storage -> division")

    # 3 ── Transfer GAGAL: stok kurang --------------------------------------
    def test_step03_transfer_insufficient(self, api, ctx):
        r = api.post("/transfers", json={
            "ingredient_id": ctx["a"], "qty": 9999,
            "from_location": "storage_kitchen", "to_location": "kitchen",
            "transfer_date": TEST_DATE,
        }, headers=ctx["headers"])
        assert r.status_code == 400, f"harus 400, dapat {r.status_code}: {r.text}"
        assert "stok" in r.text.lower(), f"pesan error harus jelas, dapat: {r.text}"

        a = _locs(ctx["a"])
        assert a["storage_kitchen"] == 2000, f"stok harus TETAP 2000, dapat {a}"
        n = ctx["db"].table("stock_transfers").select("id", count="exact").eq(
            "ingredient_id", ctx["a"]).execute().count
        assert n == 1, f"transfer reject nyangkut! count={n} (harus 1)"
        PASSED.append("3: transfer reject 400, rollback bersih")

    # 4 ── Production batch -------------------------------------------------
    def test_step04_production(self, api, ctx):
        r = api.post("/production/batches", json={
            "process_id": ctx["proc"], "batch_date": TEST_DATE,
            "raw_qty_used": 1000, "raw_unit_id": ctx["g"], "portions_actual": 8,
        }, headers=ctx["headers"])
        assert r.status_code == 201, f"batch gagal: {r.text}"

        a, c = _locs(ctx["a"]), _locs(ctx["c"])
        assert a["kitchen"] == 2000, f"A kitchen harus 3000-1000=2000, dapat {a}"
        assert c["kitchen"] == 800, f"C kitchen harus 8x100=800, dapat {c}"
        # lokasi input = lokasi output = kitchen; storage tidak tersentuh
        assert a["storage_kitchen"] == 2000, f"A storage tidak boleh berubah, dapat {a}"
        assert c["storage_kitchen"] == 0, f"C harus masuk kitchen bukan storage, dapat {c}"
        PASSED.append("4: production kurangi raw + tambah processed di kitchen")

    # 5 ── Production GAGAL: bahan kurang -----------------------------------
    def test_step05_production_insufficient(self, api, ctx):
        r = api.post("/production/batches", json={
            "process_id": ctx["proc"], "batch_date": TEST_DATE,
            "raw_qty_used": 99999, "raw_unit_id": ctx["g"], "portions_actual": 1,
        }, headers=ctx["headers"])
        assert r.status_code == 400, f"harus 400, dapat {r.status_code}: {r.text}"

        a = _locs(ctx["a"])
        assert a["kitchen"] == 2000, f"A kitchen harus TETAP 2000, dapat {a}"
        n = ctx["db"].table("production_batches").select("id", count="exact").eq(
            "process_id", ctx["proc"]).execute().count
        assert n == 1, f"batch reject nyangkut! count={n} (harus 1)"
        PASSED.append("5: production reject 400, stok utuh")

    # 6 ── Daily sales entry -------------------------------------------------
    def test_step06_sales(self, api, ctx):
        r = api.post("/sales-entry/", json={
            "entry_date": TEST_DATE,
            "entries": [{"menu_id": ctx["menu"], "qty_sold": 5, "entry_type": "sale"}],
        }, headers=ctx["headers"])
        assert r.status_code == 200, f"sales gagal: {r.text}"

        a, b, c = _locs(ctx["a"]), _locs(ctx["b"]), _locs(ctx["c"])
        # konsumsi = recipe_qty x 5, dari DIVISION — storage tidak tersentuh
        assert a["kitchen"] == 1500, f"A kitchen harus 2000-500=1500, dapat {a}"
        assert b["bar"] == 750, f"B bar harus 1000-250=750, dapat {b}"
        assert c["kitchen"] == 300, f"C kitchen harus 800-500=300, dapat {c}"
        assert a["storage_kitchen"] == 2000, f"A storage tidak boleh berubah, dapat {a}"
        assert b["storage_bar"] == 1000, f"B storage tidak boleh berubah, dapat {b}"
        PASSED.append("6: sales potong stok division sesuai BOM x qty")

    # 7 ── Sales GAGAL: stok division kurang ---------------------------------
    def test_step07_sales_insufficient(self, api, ctx):
        before = {k: _locs(ctx[k]) for k in ("a", "b", "c")}
        r = api.post("/sales-entry/", json={
            "entry_date": TEST_DATE,
            "entries": [{"menu_id": ctx["menu"], "qty_sold": 9999, "entry_type": "sale"}],
        }, headers=ctx["headers"])
        assert r.status_code == 400, f"harus 400, dapat {r.status_code}: {r.text}"

        after = {k: _locs(ctx[k]) for k in ("a", "b", "c")}
        assert before == after, f"stok berubah setelah reject!\nbefore={before}\nafter={after}"

        # snapshot-restore: entry 5 porsi dari step 6 harus masih ada, tidak partial
        rows = ctx["db"].table("daily_sales_entries").select("qty_sold").eq(
            "menu_id", ctx["menu"]).eq("entry_date", TEST_DATE).execute().data
        total = sum(r["qty_sold"] for r in rows)
        assert total == 5, f"entries harus tetap 5 porsi (restore total), dapat {total}"
        PASSED.append("7: sales reject 400, rollback total bukan partial")

    # 8 ── Waste logging ------------------------------------------------------
    def test_step08_waste(self, api, ctx):
        r = api.post("/waste", json={
            "waste_date": TEST_DATE, "ingredient_id": ctx["a"],
            "qty": 100, "unit_id": ctx["g"], "reason": "expired",
        }, headers=ctx["headers"])
        assert r.status_code == 201, f"waste gagal: {r.text}"

        a = _locs(ctx["a"])
        assert a["kitchen"] == 1400, f"A kitchen harus 1500-100=1400, dapat {a}"
        PASSED.append("8: waste potong stok kitchen")

    # 9 ── Waste GAGAL: stok kurang -------------------------------------------
    def test_step09_waste_insufficient(self, api, ctx):
        r = api.post("/waste", json={
            "waste_date": TEST_DATE, "ingredient_id": ctx["a"],
            "qty": 999999, "unit_id": ctx["g"], "reason": "expired",
        }, headers=ctx["headers"])
        assert r.status_code == 400, f"harus 400, dapat {r.status_code}: {r.text}"

        a = _locs(ctx["a"])
        assert a["kitchen"] == 1400, f"A kitchen harus TETAP 1400, dapat {a}"
        n = ctx["db"].table("waste_logs").select("id", count="exact").eq(
            "ingredient_id", ctx["a"]).execute().count
        assert n == 1, f"waste reject nyangkut! count={n} (harus 1)"
        PASSED.append("9: waste reject 400, stok utuh")

    # 10 ── Opname + variance --------------------------------------------------
    def test_step10_opname_variance(self, api, ctx):
        """
        opening (opname PREV_DATE)  = 5000
        production_in               = -1000 (raw A terpakai batch)
        theoretical_out             = 500 (sales)
        waste                       = 100
        theoretical_closing         = 5000 - 1000 - 500 - 100 = 3400
        actual (opname)             = 3000
        variance = -400, pct = -11.76% -> flagged
        """
        db = ctx["db"]
        db.table("daily_stock_opname").upsert({
            "opname_date": PREV_DATE, "ingredient_id": ctx["a"],
            "physical_qty": 5000, "unit_id": ctx["g"], "counted_by": ctx["user_id"],
        }, on_conflict="opname_date,ingredient_id").execute()

        r = api.post("/opname/", json={
            "opname_date": TEST_DATE,
            "counts": [{"ingredient_id": ctx["a"], "physical_qty": 3000,
                        "unit_id": ctx["g"]}],
        }, headers=ctx["headers"])
        assert r.status_code == 200, f"opname gagal: {r.text}"

        var = db.table("variance_reports").select("*").eq(
            "report_date", TEST_DATE).eq("ingredient_id", ctx["a"]).execute().data
        assert len(var) == 1, f"variance report harus 1 row, dapat {len(var)}"
        v = var[0]
        assert float(v["opening_qty"]) == 5000, f"opening harus 5000, dapat {v['opening_qty']}"
        assert float(v["production_in_qty"]) == -1000, \
            f"production_in harus -1000 (raw terpakai), dapat {v['production_in_qty']}"
        assert float(v["theoretical_out_qty"]) == 500, \
            f"theoretical_out harus 500, dapat {v['theoretical_out_qty']}"
        assert float(v["waste_qty"]) == 100, f"waste harus 100, dapat {v['waste_qty']}"
        assert float(v["theoretical_closing"]) == 3400, \
            f"theoretical_closing harus 3400, dapat {v['theoretical_closing']}"
        assert float(v["variance_qty"]) == -400, \
            f"variance harus 3000-3400=-400, dapat {v['variance_qty']}"
        assert float(v["variance_pct"]) == round(-400 / 3400 * 100, 2), \
            f"variance_pct salah: {v['variance_pct']}"
        assert v["is_flagged"] is True, "harus flagged (|11.76%| > 5%)"
        PASSED.append("10: opname -> variance formula benar + flagged")

    # 11 ── Adjustment (guard TIDAK berlaku) ------------------------------------
    def test_step11_adjustment(self, api, ctx):
        db = ctx["db"]
        opname = db.table("daily_stock_opname").select("id").eq(
            "opname_date", TEST_DATE).eq("ingredient_id", ctx["a"]).execute().data[0]

        total_before = _row(ctx["a"])["current_stock"]
        r = api.post(f"/opname/{opname['id']}/adjust", json={
            "reason": "opname 5 Juli",
        }, headers=ctx["headers"])
        assert r.status_code == 200, f"adjust gagal: {r.text}"

        adj = db.table("stock_adjustments").select("*").eq(
            "opname_id", opname["id"]).execute().data
        assert len(adj) == 1, "adjustment row harus tersimpan"
        assert adj[0]["reason"] == "opname 5 Juli", f"reason salah: {adj[0]['reason']}"
        assert float(adj[0]["qty_delta"]) == -400, f"delta harus -400, dapat {adj[0]['qty_delta']}"

        total_after = _row(ctx["a"])["current_stock"]
        assert total_after == total_before - 400, \
            f"ledger harus turun 400: {total_before} -> {total_after}"

        # guard tidak berlaku: adjustment boleh bikin stok negatif
        neg = db.table("stock_adjustments").insert({
            "ingredient_id": ctx["b"], "qty_delta": -99999,
            "reason": "__SMOKE test negatif", "created_by": ctx["user_id"],
        }).execute().data[0]
        b_total = _row(ctx["b"])["current_stock"]
        assert b_total < 0, f"adjustment negatif harus tembus guard, dapat {b_total}"
        db.table("stock_adjustments").delete().eq("id", neg["id"]).execute()
        PASSED.append("11: adjustment linked ke opname, guard tidak berlaku")

    # 12 ── Dashboard + /stock/current konsisten --------------------------------
    def test_step12_dashboard(self, api, ctx):
        r = api.get("/dashboard/summary", headers=ctx["headers"])
        assert r.status_code == 200, f"dashboard error: {r.text}"

        # angka stok konsisten: total = sum semua lokasi (per ingredient)
        r2 = api.get("/stock/current", headers=ctx["headers"])
        assert r2.status_code == 200, r2.text
        ours = {row["ingredient_id"]: row for row in r2.json()
                if row["ingredient_id"] in (ctx["a"], ctx["b"], ctx["c"])}
        assert len(ours) == 3, f"3 ingredient smoke harus muncul, dapat {len(ours)}"
        for iid, row in ours.items():
            loc_sum = round(sum(row["locations"].values()), 3)
            assert loc_sum == round(row["current_stock"], 3), \
                f"{row['name']}: sum lokasi {loc_sum} != current_stock {row['current_stock']}"
        # nilai akhir A: 5000 - 1000(prod) - 500(sales) - 100(waste) - 400(adjust) = 3000
        assert ours[ctx["a"]]["current_stock"] == 3000, \
            f"A total harus 3000, dapat {ours[ctx['a']]['current_stock']}"
        PASSED.append("12: dashboard OK, /stock/current konsisten dengan ledger")

    # 13 ── Cross-location isolation ---------------------------------------------
    def test_step13_isolation(self, ctx):
        a, b = _locs(ctx["a"]), _locs(ctx["b"])
        # kitchen ingredient tidak bocor ke bar dan sebaliknya
        assert a["bar"] == 0 and a["storage_bar"] == 0, f"A bocor ke bar: {a}"
        assert b["kitchen"] == 0 and b["storage_kitchen"] == 0, f"B bocor ke kitchen: {b}"
        # total global = sum lokasi
        for iid in (ctx["a"], ctx["b"], ctx["c"]):
            row = _row(iid)
            assert round(sum(row["locations"].values()), 3) == round(row["current_stock"], 3), \
                f"{row['name']}: lokasi tidak jumlah ke total"
        PASSED.append("13: kitchen/bar/storage terisolasi, total = sum lokasi")
