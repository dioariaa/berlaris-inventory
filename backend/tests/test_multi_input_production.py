"""
Self-check: Multi-input production (Arsitektur B, 2026-07-21).

Skenario:
  1. Proses multi-input (raw_ingredient_id=NULL) dengan 2 komponen standar
     (production_inputs) -> batch dengan qty aktual sedikit beda dari standar
     harus: (a) memotong stok KEDUA komponen di ledger (stock_level +
     variance), (b) menghitung portions_theoretical via rasio aktual/standar
     x output_qty_per_batch, (c) insert baris batch_inputs.
  2. Guard stok: batch yang butuh komponen melebihi stok tersedia harus
     REJECT (InsufficientStockError) TANPA insert row apa pun (batch maupun
     batch_inputs) -> membuktikan urutan guard-sebelum-insert & tidak ada
     batch yatim dari jalur reject ini.
  3. Validasi XOR router: body tanpa raw_qty_used MAUPUN inputs -> 422;
     body dengan raw_qty_used+raw_unit_id DAN inputs -> 422.
  4. Guard baca batch yatim (stock_level/variance): batch dengan
     raw_qty_used=NULL dan TANPA baris batch_inputs (simulasi kompensasi
     delete yang gagal) harus di-skip TOTAL dari ledger (bukan cuma sisi
     input, sisi output pun tidak ikut).

Jalankan: python -m tests.test_multi_input_production  (dari folder backend/)
Pakai DB Supabase live dengan data temporary (__TEST prefix) yang dibersihkan
di akhir, termasuk pada exception (try/finally).
"""
from datetime import date
from decimal import Decimal

from fastapi import HTTPException

from app.services.supabase import get_supabase_admin
from app.services.stock_guard import InsufficientStockError
from app.services.stock_level import get_current_stock
from app.services.variance import calculate_variance
from app.models.production import BatchCreate, BatchInputItem
from app.routers.production import create_batch

client = get_supabase_admin()
TEST_DATE = date(2099, 5, 1)


def _unit_id(symbol):
    return client.table("units").select("id").eq("symbol", symbol).execute().data[0]["id"]


def _fake_admin_user():
    row = client.table("users").select("id").limit(1).execute().data
    if not row:
        raise RuntimeError("Tidak ada user di DB — tidak bisa isi created_by untuk test")
    return {"sub": row[0]["id"], "role": "admin"}


def main():
    gram = _unit_id("g")
    cleanup = []  # list of (table, id) — LIFO agar FK aman
    admin_user = _fake_admin_user()

    try:
        # ── Setup: 2 raw komponen + 1 processed output ────────────────────
        kunyit = client.table("ingredients").insert({
            "name": "__TEST Kunyit", "ingredient_type": "raw", "division": "kitchen",
            "base_unit_id": gram,
        }).execute().data[0]
        jahe = client.table("ingredients").insert({
            "name": "__TEST Jahe MI", "ingredient_type": "raw", "division": "kitchen",
            "base_unit_id": gram,
        }).execute().data[0]
        bumbu = client.table("ingredients").insert({
            "name": "__TEST Bumbu Kuning", "ingredient_type": "processed", "division": "kitchen",
            "base_unit_id": gram,
        }).execute().data[0]
        cleanup += [("ingredients", kunyit["id"]), ("ingredients", jahe["id"]), ("ingredients", bumbu["id"])]

        # Stok awal komponen via stock_adjustments (unguarded) — 1000 g tiap komponen
        for iid in (kunyit["id"], jahe["id"]):
            adj = client.table("stock_adjustments").insert({
                "ingredient_id": iid, "qty_delta": 1000, "reason": "__TEST initial stock",
                "created_by": admin_user["sub"],
            }).execute().data[0]
            cleanup.insert(0, ("stock_adjustments", adj["id"]))

        # ── Proses multi-input: raw_ingredient_id=NULL ────────────────────
        proc = client.table("production_processes").insert({
            "name": "__TEST Bumbu Kuning Process",
            "raw_ingredient_id": None,
            "output_ingredient_id": bumbu["id"],
        }).execute().data[0]
        cleanup.insert(0, ("production_processes", proc["id"]))

        # Standar: 500 g Kunyit + 300 g Jahe -> 750 g Bumbu Kuning per batch standar
        std_rows = client.table("production_inputs").insert([
            {"process_id": proc["id"], "ingredient_id": kunyit["id"], "qty_per_batch": 500, "unit_id": gram},
            {"process_id": proc["id"], "ingredient_id": jahe["id"],   "qty_per_batch": 300, "unit_id": gram},
        ]).execute().data
        for r in std_rows:
            cleanup.insert(0, ("production_inputs", r["id"]))

        out_row = client.table("production_outputs").insert({
            "process_id": proc["id"], "output_ingredient_id": bumbu["id"],
            "output_qty_per_batch": 750, "unit_id": gram,
        }).execute().data[0]
        cleanup.insert(0, ("production_outputs", out_row["id"]))

        # ══════════════════════════════════════════════════════════════════
        # TEST 1 — batch normal, qty aktual sedikit beda dari standar
        # ══════════════════════════════════════════════════════════════════
        # Aktual: 550 g Kunyit + 250 g Jahe (total 800 vs standar 800 — sama
        # totalnya tapi komposisi beda, untuk pastikan tiap komponen dihitung
        # sendiri-sendiri, bukan cuma total). scale = 800/800 = 1.0
        # -> theoretical = 1.0 x 750 = 750
        body = BatchCreate(
            process_id=proc["id"], batch_date=TEST_DATE,
            inputs=[
                BatchInputItem(ingredient_id=kunyit["id"], qty_used=Decimal("550"), unit_id=gram),
                BatchInputItem(ingredient_id=jahe["id"],   qty_used=Decimal("250"), unit_id=gram),
            ],
            portions_actual=780,  # actual vs theoretical 750 -> variance +4% (tidak flagged, threshold 5%)
        )
        result = create_batch(body, user=admin_user)
        batch_id = result["id"]
        cleanup.insert(0, ("production_batches", batch_id))

        assert result["raw_qty_used"] is None, f"raw_qty_used harus NULL utk multi-input, dapat {result['raw_qty_used']}"
        assert result["portions_theoretical"] == 750.0, \
            f"theoretical harus 750 (scale 1.0 x 750), dapat {result['portions_theoretical']}"
        assert abs(result["variance_pct"] - 4.0) < 0.01, \
            f"variance harus ~4%, dapat {result['variance_pct']}"
        assert result["is_flagged"] is False, "variance 4% tidak boleh di-flag (threshold 5%)"
        assert len(result["inputs"]) == 2, f"response harus punya 2 batch_inputs, dapat {len(result['inputs'])}"
        print("PASS 1a: batch multi-input dibuat, theoretical=750, variance~4%, tidak flagged")

        bi_rows = client.table("batch_inputs").select("*").eq("batch_id", batch_id).execute().data
        assert len(bi_rows) == 2, f"harus ada 2 baris batch_inputs, dapat {len(bi_rows)}"
        print("PASS 1b: 2 baris batch_inputs tersimpan di DB")

        # Ledger: stock_level HARUS memotong Kunyit -550, Jahe -250, Bumbu +780
        stock = {r["ingredient_id"]: r for r in get_current_stock([kunyit["id"], jahe["id"], bumbu["id"]])}
        assert stock[kunyit["id"]]["current_stock"] == 450, \
            f"Kunyit harus 1000-550=450, dapat {stock[kunyit['id']]['current_stock']}"
        assert stock[jahe["id"]]["current_stock"] == 750, \
            f"Jahe harus 1000-250=750, dapat {stock[jahe['id']]['current_stock']}"
        assert stock[bumbu["id"]]["current_stock"] == 780, \
            f"Bumbu harus +780, dapat {stock[bumbu['id']]['current_stock']}"
        print("PASS 1c: stock_level.py memotong kedua komponen & menambah output dengan benar")

        # calculate_variance hanya memproses ingredient yang punya baris opname
        # pada tanggal ini (lihat variance.py: ing_ids berasal dari opname_today).
        # Nilai physical_qty tidak relevan untuk assertion di test ini — yang
        # dicek hanya komponen production_in_qty.
        opname_rows = client.table("daily_stock_opname").insert([
            {"opname_date": TEST_DATE.isoformat(), "ingredient_id": iid, "physical_qty": 0, "unit_id": gram}
            for iid in (kunyit["id"], jahe["id"], bumbu["id"])
        ]).execute().data
        for r in opname_rows:
            cleanup.insert(0, ("daily_stock_opname", r["id"]))

        # Ledger: variance.py (production_in_qty) harus konsisten
        # calculate_variance upsert ke variance_reports (side effect, tanpa "id"
        # di return value) — dibersihkan terpisah by report_date di finally,
        # SEBELUM ingredients (FK).
        var_rows = calculate_variance(TEST_DATE, client)
        var_map = {r["ingredient_id"]: r for r in var_rows}
        assert var_map[kunyit["id"]]["production_in_qty"] == -550, \
            f"variance Kunyit production_in harus -550, dapat {var_map[kunyit['id']]['production_in_qty']}"
        assert var_map[jahe["id"]]["production_in_qty"] == -250, \
            f"variance Jahe production_in harus -250, dapat {var_map[jahe['id']]['production_in_qty']}"
        assert var_map[bumbu["id"]]["production_in_qty"] == 780, \
            f"variance Bumbu production_in harus +780, dapat {var_map[bumbu['id']]['production_in_qty']}"
        print("PASS 1d: variance.py konsisten dengan stock_level.py untuk multi-input")

        # ══════════════════════════════════════════════════════════════════
        # TEST 2 — guard reject: minta lebih dari stok tersisa (450 Kunyit)
        # ══════════════════════════════════════════════════════════════════
        body_reject = BatchCreate(
            process_id=proc["id"], batch_date=TEST_DATE,
            inputs=[
                BatchInputItem(ingredient_id=kunyit["id"], qty_used=Decimal("999999"), unit_id=gram),
                BatchInputItem(ingredient_id=jahe["id"],   qty_used=Decimal("100"), unit_id=gram),
            ],
            portions_actual=100,
        )
        before_batches = client.table("production_batches").select("id", count="exact").eq("process_id", proc["id"]).execute().count
        before_inputs  = client.table("batch_inputs").select("id", count="exact").execute().count
        try:
            create_batch(body_reject, user=admin_user)
            raise AssertionError("harusnya reject InsufficientStockError, tapi lolos")
        except InsufficientStockError:
            pass
        after_batches = client.table("production_batches").select("id", count="exact").eq("process_id", proc["id"]).execute().count
        after_inputs  = client.table("batch_inputs").select("id", count="exact").execute().count
        assert before_batches == after_batches, "guard reject tidak boleh insert row production_batches"
        assert before_inputs == after_inputs, "guard reject tidak boleh insert row batch_inputs"
        print("PASS 2: guard stok reject qty berlebih, TIDAK ADA row baru (batch maupun batch_inputs)")

        # ══════════════════════════════════════════════════════════════════
        # TEST 3 — validasi XOR di router (bukan Pydantic)
        # ══════════════════════════════════════════════════════════════════
        body_empty = BatchCreate(process_id=proc["id"], batch_date=TEST_DATE, portions_actual=10)
        try:
            create_batch(body_empty, user=admin_user)
            raise AssertionError("harusnya 422 (kosong dua-duanya), tapi lolos")
        except HTTPException as e:
            assert e.status_code == 422
            assert isinstance(e.detail, str), f"detail harus string (bukan array Pydantic), dapat {type(e.detail)}"
            assert "Isi salah satu" in e.detail
        print("PASS 3a: XOR reject saat raw & inputs kosong dua-duanya (pesan string Indonesia)")

        body_both = BatchCreate(
            process_id=proc["id"], batch_date=TEST_DATE,
            raw_qty_used=Decimal("1"), raw_unit_id=gram,
            inputs=[BatchInputItem(ingredient_id=kunyit["id"], qty_used=Decimal("1"), unit_id=gram)],
            portions_actual=10,
        )
        try:
            create_batch(body_both, user=admin_user)
            raise AssertionError("harusnya 422 (dua-duanya terisi), tapi lolos")
        except HTTPException as e:
            assert e.status_code == 422
            assert isinstance(e.detail, str)
        print("PASS 3b: XOR reject saat raw & inputs terisi dua-duanya")

        # ══════════════════════════════════════════════════════════════════
        # TEST 4 — guard baca: batch yatim (raw_qty_used=NULL, tanpa batch_inputs)
        # ══════════════════════════════════════════════════════════════════
        orphan = client.table("production_batches").insert({
            "process_id": proc["id"], "batch_date": TEST_DATE.isoformat(),
            "raw_qty_used": None, "raw_unit_id": None,
            "portions_actual": 999,  # kalau tidak di-skip, ini akan mencemari stok Bumbu +999
        }).execute().data[0]
        cleanup.insert(0, ("production_batches", orphan["id"]))

        stock_after_orphan = {r["ingredient_id"]: r for r in get_current_stock([bumbu["id"]])}
        assert stock_after_orphan[bumbu["id"]]["current_stock"] == 780, \
            (f"batch yatim TIDAK boleh menyumbang stok (harus tetap 780), "
             f"dapat {stock_after_orphan[bumbu['id']]['current_stock']}")
        print("PASS 4: batch yatim (tanpa raw_qty_used maupun batch_inputs) di-skip TOTAL dari ledger")

        print("\nALL PASS — multi-input production (schema, ledger, guard, XOR, batch yatim)")

    finally:
        # variance_reports: efek samping calculate_variance, tanpa "id" di
        # return value -> hapus by report_date, SEBELUM ingredients (FK).
        client.table("variance_reports").delete().eq("report_date", TEST_DATE.isoformat()).execute()
        for table, rid in cleanup:
            client.table(table).delete().eq("id", rid).execute()


if __name__ == "__main__":
    main()
