# -*- coding: utf-8 -*-
"""
Test avg_cost + HPP recalc end-to-end.

Skenario:
  Ingredient: Ayam Berlaris (processed, base_unit=prs)
    - Anggap avg_cost awal = 0 (history kosong)
    - Receipt 1: 100 prs @ Rp 3.000/prs
      → new_avg = (0*0 + 3000*100) / (0+100) = Rp 3.000/prs
    - Receipt 2: 50 prs @ Rp 4.000/prs
      → new_avg = (3000*100 + 4000*50) / (100+50) = (300.000+200.000)/150 = Rp 3.333,33/prs
    - Receipt 3 dalam satuan berbeda — skip jika unit conversion tidak ada

  HPP: buat test menu dengan BOM 1 prs Ayam Berlaris
    - Setelah receipt 1: HPP = 1 × 3.000 / cumulative_yield ≈ ... (tergantung process)
    - Setelah receipt 2: HPP naik karena harga naik

  Unit conversion: jika ada unit kg→prs, test juga.
"""
import os, sys, requests
sys.stdout.reconfigure(encoding="utf-8")
from pathlib import Path
from dotenv import load_dotenv
from supabase import create_client
from datetime import date

ROOT = Path(__file__).resolve().parent
load_dotenv(ROOT / "backend" / ".env")  # SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
load_dotenv(ROOT / ".env.test")         # TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD

BASE      = "http://localhost:8000"
TEST_DATE = "2099-04-01"

db = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])

ADMIN_EMAIL    = os.environ.get("TEST_ADMIN_EMAIL", "admin@berlaris.com")
ADMIN_PASSWORD = os.environ.get("TEST_ADMIN_PASSWORD")
if not ADMIN_PASSWORD:
    sys.exit("TEST_ADMIN_PASSWORD belum di-set — isi di .env.test (root project) atau env var.")

# ── Auth ──────────────────────────────────────────────────────────────────────
r = requests.post(f"{BASE}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
assert r.status_code == 200, f"Login gagal: {r.text}"
token = r.json()["access_token"]
H  = {"Authorization": f"Bearer {token}"}
HJ = {**H, "Content-Type": "application/json"}

def api(method, path, **kw):
    return getattr(requests, method)(f"{BASE}{path}", headers=HJ, **kw)

def check(label, got, expected, tol=1.0):
    ok = got is not None and abs(float(got) - float(expected)) < tol
    print(f"    {'PASS' if ok else 'FAIL'}: {label} = {got} (expected {expected})")
    return ok

print("=" * 60)
print("TEST: avg_cost + HPP recalc")
print("=" * 60)

# ── Lookup ────────────────────────────────────────────────────────────────────
print("\n[setup] Lookup units & ingredients...")
units_map = {u["symbol"]: u for u in db.table("units").select("id,name,symbol").execute().data}
unit_prs = units_map.get("prs")
assert unit_prs, "FAIL: unit prs tidak ditemukan"
print(f"    unit prs: {unit_prs['id']}")

# Cari Ayam Berlaris (processed, base_unit=prs)
ayam_berlaris_rows = db.table("ingredients").select("id,name,base_unit_id,avg_cost_per_unit").ilike("name", "%Ayam Berlaris%").limit(1).execute().data
assert ayam_berlaris_rows, "FAIL: Ayam Berlaris tidak ada di DB"
ing = ayam_berlaris_rows[0]
print(f"    Ayam Berlaris: {ing['id']} (base_unit={ing['base_unit_id']})")
print(f"    avg_cost sekarang: Rp {ing['avg_cost_per_unit']}")

# Simpan avg_cost awal untuk restore nanti
original_avg_cost = float(ing["avg_cost_per_unit"] or 0)

# ── Clean state ───────────────────────────────────────────────────────────────
print("\n[setup] Clean state...")
db.table("ingredient_cost_history").delete().eq("ingredient_id", ing["id"]).execute()
db.table("ingredients").update({"avg_cost_per_unit": 0}).eq("id", ing["id"]).execute()
print("    ingredient_cost_history dibersihkan, avg_cost di-reset ke 0")

# Buat test menu + recipe (1 prs Ayam Berlaris per porsi)
menu_r = api("post", "/menus/", json={
    "name": "_TEST Menu Avg Cost", "category": "main_course",
    "division": "kitchen", "selling_price": 50000
})
assert menu_r.status_code == 201, menu_r.text
menu_id = menu_r.json()["id"]
api("post", f"/menus/{menu_id}/recipe", json={"items": [
    {"ingredient_id": ing["id"], "qty": 1, "unit_id": unit_prs["id"]}
]})
print(f"    Test menu: {menu_id}")

# ═══════════════════════════════════════════════════════════════════════════════
# TEST 1: Receipt pertama — 100 prs @ Rp 3.000
# ═══════════════════════════════════════════════════════════════════════════════
print(f"\n[1] POST /calculate/avg-cost — Receipt 1: 100 prs @ Rp 3.000")
r1 = api("post", f"/calculate/avg-cost/{ing['id']}", json={
    "new_qty": 100,
    "new_price_per_unit": 3000,
    "unit_id": unit_prs["id"],
})
assert r1.status_code == 200, f"FAIL: {r1.status_code} {r1.text}"
d1 = r1.json()
print(f"    old_avg: Rp {d1['old_avg_cost']}")
print(f"    new_avg: Rp {d1['new_avg_cost']}")
print(f"    menus_recalculated: {d1['menus_recalculated']}")
check("new_avg (expected 3000)", d1["new_avg_cost"], 3000, tol=1)
assert d1["menus_recalculated"] >= 1, "FAIL: HPP recalc tidak terpicu"

# Cek DB
db_ing = db.table("ingredients").select("avg_cost_per_unit").eq("id", ing["id"]).single().execute().data
check("DB avg_cost_per_unit", db_ing["avg_cost_per_unit"], 3000, tol=1)

hist_count = len(db.table("ingredient_cost_history").select("id").eq("ingredient_id", ing["id"]).execute().data)
print(f"    history entries: {hist_count} (expected 1)")
assert hist_count == 1, "FAIL: history tidak diinsert"

# ═══════════════════════════════════════════════════════════════════════════════
# TEST 2: Receipt kedua — 50 prs @ Rp 4.000 → weighted avg = 3.333,33
# ═══════════════════════════════════════════════════════════════════════════════
print(f"\n[2] POST /calculate/avg-cost — Receipt 2: 50 prs @ Rp 4.000")
r2 = api("post", f"/calculate/avg-cost/{ing['id']}", json={
    "new_qty": 50,
    "new_price_per_unit": 4000,
    "unit_id": unit_prs["id"],
})
assert r2.status_code == 200, f"FAIL: {r2.status_code} {r2.text}"
d2 = r2.json()
print(f"    old_avg: Rp {d2['old_avg_cost']} (expected 3000)")
print(f"    new_avg: Rp {d2['new_avg_cost']} (expected 3333.33)")
check("old_avg sebelum receipt 2", d2["old_avg_cost"], 3000, tol=1)
# (3000*100 + 4000*50) / 150 = 500000/150 = 3333.33
check("new_avg weighted (expected 3333.33)", d2["new_avg_cost"], 3333.33, tol=1)

hist_count2 = len(db.table("ingredient_cost_history").select("id").eq("ingredient_id", ing["id"]).execute().data)
print(f"    history entries: {hist_count2} (expected 2)")
assert hist_count2 == 2, "FAIL: history entry ke-2 tidak ada"

# ═══════════════════════════════════════════════════════════════════════════════
# TEST 3: POST /calculate/hpp — recalc manual untuk menu ini
# ═══════════════════════════════════════════════════════════════════════════════
print(f"\n[3] POST /calculate/hpp?menu_id=...")
r3 = api("post", f"/calculate/hpp?menu_id={menu_id}")
assert r3.status_code == 200, f"FAIL: {r3.status_code} {r3.text}"
d3 = r3.json()
print(f"    menus_calculated: {d3['menus_calculated']}")
print(f"    period_month: {d3['period_month']}")
assert d3["menus_calculated"] == 1, "FAIL"

result = d3["results"][0]
print(f"    hpp: Rp {result['hpp']}")
print(f"    food_cost_pct: {result['food_cost_pct']}%")
print(f"    selling_price: Rp {result['selling_price']}")
# HPP = 1 × avg_cost / cumulative_yield
# Jika tidak ada production process: HPP = avg_cost = 3333.33
# Jika ada process dengan yield 62.05%: HPP = 3333.33 / 0.6205 ≈ 5372
print(f"    (HPP = avg_cost ÷ cumulative_yield, tergantung production process Ayam Berlaris)")
assert result["hpp"] > 0, "FAIL: HPP harus > 0"
assert result["food_cost_pct"] > 0, "FAIL: food_cost_pct harus > 0"

# ═══════════════════════════════════════════════════════════════════════════════
# TEST 4: POST /calculate/hpp bulk (tanpa menu_id) — harus berhasil semua
# ═══════════════════════════════════════════════════════════════════════════════
print(f"\n[4] POST /calculate/hpp (bulk — tanpa menu_id)")
r4 = api("post", "/calculate/hpp")
assert r4.status_code == 200, f"FAIL: {r4.status_code} {r4.text}"
d4 = r4.json()
print(f"    menus_calculated: {d4['menus_calculated']} menu(s)")
print(f"    period_month: {d4['period_month']}")
assert d4["menus_calculated"] >= 1, "FAIL: tidak ada menu yang di-recalc"
print("    PASS: bulk HPP recalc OK")

# ═══════════════════════════════════════════════════════════════════════════════
# TEST 5: Validasi menu_hpp tersimpan di DB
# ═══════════════════════════════════════════════════════════════════════════════
print(f"\n[5] Cek menu_hpp di DB")
today = date.today()
period_month_str = f"{today.year}-{today.month:02d}-01"
hpp_row = db.table("menu_hpp").select("*").eq("menu_id", menu_id).eq("period_month", period_month_str).maybe_single().execute().data
assert hpp_row, f"FAIL: menu_hpp tidak ada di DB untuk period {period_month_str}"
print(f"    hpp_amount: Rp {hpp_row['hpp_amount']}")
print(f"    food_cost_pct: {hpp_row['food_cost_pct']}%")
assert float(hpp_row["hpp_amount"]) > 0, "FAIL"
print("    PASS: menu_hpp tersimpan di DB")

# ─── Cleanup ─────────────────────────────────────────────────────────────────
print("\n[cleanup]")
requests.delete(f"{BASE}/menus/{menu_id}", headers=H)
db.table("ingredient_cost_history").delete().eq("ingredient_id", ing["id"]).execute()
db.table("ingredients").update({"avg_cost_per_unit": original_avg_cost}).eq("id", ing["id"]).execute()
db.table("menu_hpp").delete().eq("menu_id", menu_id).execute()
print(f"    avg_cost dikembalikan ke Rp {original_avg_cost}")
print("    Data test dibersihkan")

print("\n" + "=" * 60)
print("TEST SELESAI")
print("=" * 60)
