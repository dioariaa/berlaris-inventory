"""
Self-check: rekap belanja dashboard.

Insert 1 receipt dengan 3 item beda kategori, hit GET /dashboard/purchases
(daily, tanggal unik 2020-03-01), assert angka per kategori & grand total
match manual sum. READ ONLY endpoint — tidak mengubah formula apapun.

Jalankan: python -m tests.test_dashboard_purchases  (dari folder backend/)
"""
from datetime import date

from app.services.supabase import get_supabase_admin
from app.routers.dashboard import purchases_recap

client = get_supabase_admin()

TEST_DATE = date(2020, 3, 1)  # tanggal unik supaya tidak bentrok data nyata


def main():
    gram = client.table("units").select("id").eq("symbol", "g").execute().data[0]["id"]
    uid  = client.table("users").select("id").limit(1).execute().data[0]["id"]
    cleanup = []
    try:
        ing = client.table("ingredients").insert({
            "name": "__TEST Rekap", "ingredient_type": "raw", "division": "kitchen",
            "base_unit_id": gram,
        }).execute().data[0]
        cleanup.append(("ingredients", ing["id"]))

        receipt = client.table("goods_receipts").insert({
            "received_date": TEST_DATE.isoformat(), "received_by": uid,
            "notes": "__TEST rekap",
        }).execute().data[0]
        cleanup.insert(0, ("goods_receipts", receipt["id"]))

        # 3 item beda kategori: qty × harga
        items = [
            ("storage_kitchen", 2, 5000),   # 10.000
            ("bar",             3, 2000),   #  6.000
            ("staff_meal",      1, 8000),   #  8.000
        ]
        for cat, qty, price in items:
            row = client.table("receipt_items").insert({
                "receipt_id": receipt["id"], "ingredient_id": ing["id"],
                "received_qty": qty, "unit_id": gram,
                "actual_price_per_unit": price, "po_category": cat,
            }).execute().data[0]
            cleanup.insert(0, ("receipt_items", row["id"]))

        res = purchases_recap(range="daily", target_date=TEST_DATE, user={"role": "admin"})

        assert res["by_category"]["storage_kitchen"] == 10000, res
        assert res["by_category"]["bar"]             == 6000,  res
        assert res["by_category"]["staff_meal"]      == 8000,  res
        assert res["by_category"]["storage_bar"]     == 0,     res
        assert res["total"]                          == 24000, res
        assert res["date_from"] == res["date_to"] == TEST_DATE.isoformat()

        # weekly harus juga mencakup tanggal itu
        res_w = purchases_recap(range="weekly", target_date=TEST_DATE, user={"role": "admin"})
        assert res_w["total"] == 24000, res_w

        print("PASS: rekap daily 10000/6000/8000, grand total 24000; weekly match")
    finally:
        for table, rid in cleanup:
            client.table(table).delete().eq("id", rid).execute()


if __name__ == "__main__":
    main()
