"""
Self-check: HPP breakdown per ingredient.

Menu dengan 3 BOM line (raw, base unit sama dengan recipe unit), assert:
  - tiap baris breakdown: ingredient_hpp == qty × avg_cost (unit cost)
  - hpp total == SUM baris
  - food_cost_pct == hpp / selling_price × 100

Pakai formula recalc_hpp yang SUDAH ADA — test ini memastikan angka yang
ditampilkan UI HPP Management (yang membaca hasil recalc_hpp) benar.

Jalankan: python -m tests.test_hpp_breakdown  (dari folder backend/)
"""
from app.services.supabase import get_supabase_admin
from app.services.hpp import recalc_hpp

client = get_supabase_admin()


def main():
    gram = client.table("units").select("id").eq("symbol", "g").execute().data[0]["id"]
    cleanup = []
    try:
        # 3 raw ingredient dengan avg_cost berbeda
        spec = [("__TEST HPP A", 100, 50), ("__TEST HPP B", 20, 300), ("__TEST HPP C", 5, 1000)]
        # (nama, qty_recipe_gram, avg_cost_per_g) → line total: 5000, 6000, 5000
        ings = []
        for name, _, cost in spec:
            ing = client.table("ingredients").insert({
                "name": name, "ingredient_type": "raw", "division": "kitchen",
                "base_unit_id": gram, "avg_cost_per_unit": cost,
            }).execute().data[0]
            ings.append(ing)
            cleanup.append(("ingredients", ing["id"]))

        menu = client.table("menu_items").insert({
            "name": "__TEST Menu HPP", "category": "other", "division": "kitchen",
            "selling_price": 40000,
        }).execute().data[0]
        cleanup.insert(0, ("menu_items", menu["id"]))

        for ing, (_, qty, _) in zip(ings, spec):
            r = client.table("recipes").insert({
                "menu_id": menu["id"], "ingredient_id": ing["id"],
                "qty": qty, "unit_id": gram,
            }).execute().data[0]
            cleanup.insert(0, ("recipes", r["id"]))

        result = recalc_hpp(menu["id"], client=client)
        cleanup.insert(0, ("menu_hpp_by_menu", menu["id"]))  # handled khusus di bawah

        by_name = {b["ingredient_name"]: b for b in result["ingredient_breakdown"]}
        expected_lines = {"__TEST HPP A": (100, 50, 5000), "__TEST HPP B": (20, 300, 6000), "__TEST HPP C": (5, 1000, 5000)}
        for name, (qty, cost, total) in expected_lines.items():
            b = by_name[name]
            assert b["qty_in_base_unit"] == qty,   f"{name}: qty {b['qty_in_base_unit']} != {qty}"
            assert b["effective_cost"]   == cost,  f"{name}: unit cost {b['effective_cost']} != {cost}"
            assert b["ingredient_hpp"]   == total, f"{name}: total {b['ingredient_hpp']} != {total}"

        assert result["hpp"] == 16000, f"hpp {result['hpp']} != 16000"
        expected_fc = 16000 / 40000 * 100  # = 40.0
        assert abs(result["food_cost_pct"] - expected_fc) < 0.01, \
            f"food_cost_pct {result['food_cost_pct']} != {expected_fc}"

        print(f"PASS: 3 baris (5000+6000+5000), HPP 16000, FC% {result['food_cost_pct']:.1f} == 40.0")
    finally:
        for table, rid in cleanup:
            if table == "menu_hpp_by_menu":
                client.table("menu_hpp").delete().eq("menu_id", rid).execute()
            else:
                client.table(table).delete().eq("id", rid).execute()


if __name__ == "__main__":
    main()
