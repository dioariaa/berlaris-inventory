"""
Self-check Task 1: produksi processed item HARUS memotong raw material di ledger
dalam base unit yang benar, dan menambah stok processed item dalam base unit output.

Skenario: raw base unit = gram, batch dicatat 2 kg → deduksi harus 2000 g (bukan 2).
Output base unit = ml, portion_size_g = 1000 → 2 porsi = +2000 ml (bukan +2).

Kode LAMA (tanpa unit conversion di stock_level.py) menghasilkan raw = -2 dan
processed = +2 → test ini FAIL. Kode baru → PASS.

Jalankan: python -m tests.test_production_deduction  (dari folder backend/)
Pakai DB Supabase live dengan data temporary yang dibersihkan di akhir.
"""
from datetime import date

from app.services.supabase import get_supabase_admin
from app.services.stock_level import get_current_stock

client = get_supabase_admin()


def _unit_id(symbol):
    return client.table("units").select("id").eq("symbol", symbol).execute().data[0]["id"]


def main():
    gram, kg, ml = _unit_id("g"), _unit_id("kg"), _unit_id("ml")
    cleanup = []
    try:
        raw = client.table("ingredients").insert({
            "name": "__TEST Raw Gula", "ingredient_type": "raw", "division": "bar",
            "base_unit_id": gram,
        }).execute().data[0]
        out = client.table("ingredients").insert({
            "name": "__TEST Gula Cair Out", "ingredient_type": "processed", "division": "bar",
            "base_unit_id": ml, "portion_size_g": 1000,
        }).execute().data[0]
        cleanup.append(("ingredients", raw["id"]))
        cleanup.append(("ingredients", out["id"]))

        proc = client.table("production_processes").insert({
            "name": "__TEST proses", "raw_ingredient_id": raw["id"],
            "output_ingredient_id": out["id"], "portion_size_g": 1000,
        }).execute().data[0]
        cleanup.insert(0, ("production_processes", proc["id"]))

        batch = client.table("production_batches").insert({
            "process_id": proc["id"], "batch_date": date.today().isoformat(),
            "raw_qty_used": 2, "raw_unit_id": kg,      # 2 kg = 2000 g
            "portions_actual": 2,                       # 2 porsi × 1000 ml
        }).execute().data[0]
        cleanup.insert(0, ("production_batches", batch["id"]))

        stock = {r["ingredient_id"]: r for r in get_current_stock([raw["id"], out["id"]])}

        raw_stock = stock[raw["id"]]
        out_stock = stock[out["id"]]

        assert raw_stock["current_stock"] == -2000, \
            f"raw harus terpotong 2000 g, dapat {raw_stock['current_stock']}"
        assert raw_stock["locations"]["bar"] == -2000, \
            f"deduksi raw harus di lokasi bar, dapat {raw_stock['locations']}"
        assert out_stock["current_stock"] == 2000, \
            f"processed harus bertambah 2000 ml, dapat {out_stock['current_stock']}"
        assert out_stock["locations"]["bar"] == 2000, \
            f"inflow processed harus di lokasi bar, dapat {out_stock['locations']}"

        print("PASS: raw -2000 g & processed +2000 ml di lokasi bar")
    finally:
        for table, rid in cleanup:
            client.table(table).delete().eq("id", rid).execute()


if __name__ == "__main__":
    main()
