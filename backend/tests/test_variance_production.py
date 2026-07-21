"""
Self-check: production_in_qty di variance HARUS dinormalisasi ke base unit.

Skenario: raw base unit = gram, batch dicatat 2 kg → production_in raw = -2000 g
(raw terpakai produksi). Output base unit = ml, portion_size_g = 1000 →
2 porsi = +2000 ml.

Kode LAMA (production_in stub = 0) menghasilkan production_in 0 untuk keduanya
→ test ini FAIL. Kode baru → PASS.

Jalankan: python -m tests.test_variance_production  (dari folder backend/)
Pakai DB Supabase live dengan data temporary yang dibersihkan di akhir.
"""
from datetime import date

from app.services.supabase import get_supabase_admin
from app.services.variance import calculate_variance

client = get_supabase_admin()


def _unit_id(symbol):
    return client.table("units").select("id").eq("symbol", symbol).execute().data[0]["id"]


def main():
    gram, kg, ml = _unit_id("g"), _unit_id("kg"), _unit_id("ml")
    today = date.today()
    cleanup = []
    try:
        raw = client.table("ingredients").insert({
            "name": "__TEST Var Raw Gula", "ingredient_type": "raw", "division": "bar",
            "base_unit_id": gram,
        }).execute().data[0]
        out = client.table("ingredients").insert({
            "name": "__TEST Var Gula Cair Out", "ingredient_type": "processed", "division": "bar",
            "base_unit_id": ml, "portion_size_g": 1000,
        }).execute().data[0]
        cleanup.append(("ingredients", raw["id"]))
        cleanup.append(("ingredients", out["id"]))

        proc = client.table("production_processes").insert({
            "name": "__TEST var proses", "raw_ingredient_id": raw["id"],
            "output_ingredient_id": out["id"], "portion_size_g": 1000,
        }).execute().data[0]
        cleanup.insert(0, ("production_processes", proc["id"]))

        batch = client.table("production_batches").insert({
            "process_id": proc["id"], "batch_date": today.isoformat(),
            "raw_qty_used": 2, "raw_unit_id": kg,      # 2 kg = 2000 g
            "portions_actual": 2,                       # 2 porsi × 1000 ml
        }).execute().data[0]
        cleanup.insert(0, ("production_batches", batch["id"]))

        counted_by = (client.table("users").select("id").limit(1).execute().data or [{}])[0].get("id")
        for ing, unit in ((raw, gram), (out, ml)):
            row = {
                "opname_date":   today.isoformat(),
                "ingredient_id": ing["id"],
                "physical_qty":  0,
                "unit_id":       unit,
            }
            if counted_by:
                row["counted_by"] = counted_by
            op = client.table("daily_stock_opname").insert(row).execute().data[0]
            cleanup.insert(0, ("daily_stock_opname", op["id"]))

        results = {r["ingredient_id"]: r for r in calculate_variance(today, client)}
        # variance_reports rows dibuat oleh calculate_variance — hapus juga
        for iid in (raw["id"], out["id"]):
            client.table("variance_reports").delete() \
                .eq("report_date", today.isoformat()).eq("ingredient_id", iid).execute()

        raw_res = results[raw["id"]]
        out_res = results[out["id"]]

        assert raw_res["production_in_qty"] == -2000, \
            f"production_in raw harus -2000 g (2 kg terpakai), dapat {raw_res['production_in_qty']}"
        assert out_res["production_in_qty"] == 2000, \
            f"production_in output harus +2000 ml (2 porsi × 1000), dapat {out_res['production_in_qty']}"
        assert raw_res["theoretical_closing"] == -2000, \
            f"theoretical_closing raw harus -2000, dapat {raw_res['theoretical_closing']}"
        assert out_res["theoretical_closing"] == 2000, \
            f"theoretical_closing output harus 2000, dapat {out_res['theoretical_closing']}"

        print("PASS: production_in raw -2000 g & output +2000 ml di variance")
    finally:
        for table, rid in cleanup:
            client.table(table).delete().eq("id", rid).execute()


if __name__ == "__main__":
    main()
