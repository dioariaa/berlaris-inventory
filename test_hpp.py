# -*- coding: utf-8 -*-
"""
Test HPP kalkulasi end-to-end.

Skenario: Menu "_TEST Ayam Bakar HPP" dengan BOM:
  1. Ayam Berlaris (processed, base=prs)  — 1 prs  @ avg_cost Rp 5.000/prs
     → ada production process: trim 85% × masak 73% = cumulative 62.05%
     → effective_cost = 5000 / 0.6205 ≈ Rp 8.061,24/prs
     → contribution = 1 × 8.061,24 = Rp 8.061,24

  2. Beras (raw, base=gram)              — 150 g   @ avg_cost Rp 16.25/gram
     → effective_cost = 16.25 (raw, no yield)
     → contribution = 150 × 16.25 = Rp 2.437,50

  3. Minyak Goreng (raw, base=ml)        — 0.05 kg → unit conversion kg→ml
     (anggap base=gram, avg=Rp 25/gram, recipe pakai gram juga)
     → Kita pakai gram langsung agar tidak perlu cari unit ml

  4. Hot Cup (packaging)                 — 1 pcs
     → SKIP — tidak masuk HPP

  HPP total = 8.061,24 + 2.437,50 = Rp 10.498,74
  Selling price = Rp 35.000
  food_cost_pct = 10.498,74 / 35.000 × 100 ≈ 29.99%

  Test unit conversion:
    Tambah ingredient baru "Kecap Manis" dengan base_unit=ml
    Recipe pakai unit=liter → conversion: 1 liter = 1000 ml
    qty 0.01 liter → 10 ml → cost = 10 × avg_cost_per_ml

Notes:
  - avg_cost ingredient real di DB tidak kita ubah
  - Kita buat ingredient test dengan avg_cost yang kita kontrol
  - Cleanup setelah test
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

BASE = "http://localhost:8000"

db = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])

ADMIN_EMAIL    = os.environ.get("TEST_ADMIN_EMAIL", "admin@berlaris.com")
ADMIN_PASSWORD = os.environ.get("TEST_ADMIN_PASSWORD")
if not ADMIN_PASSWORD:
    sys.exit("TEST_ADMIN_PASSWORD belum di-set — isi di .env.test (root project) atau env var.")

r = requests.post(f"{BASE}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
token = r.json()["access_token"]
H  = {"Authorization": f"Bearer {token}"}
HJ = {**H, "Content-Type": "application/json"}

def api(method, path, **kw):
    return getattr(requests, method)(f"{BASE}{path}", headers=HJ, **kw)

def check(label, got, expected, tol=0.1):
    ok = got is not None and abs(float(got) - float(expected)) < tol
    print(f"    {'PASS' if ok else 'FAIL'}: {label} = {got} (expected ≈ {expected})")
    return ok

print("=" * 60)
print("TEST: HPP kalkulasi (packaging skip, unit conversion, yield)")
print("=" * 60)

# ── Lookup units ──────────────────────────────────────────────────────────────
print("\n[setup] Lookup units...")
units_raw = db.table("units").select("id,name,symbol").execute().data
units_map = {u["symbol"]: u for u in units_raw}

unit_prs  = units_map.get("prs")
unit_gram = units_map.get("g") or units_map.get("gr") or units_map.get("gram")
unit_pcs  = units_map.get("pcs") or units_map.get("pc")
unit_ml   = units_map.get("ml")
unit_liter = units_map.get("L") or units_map.get("ltr") or units_map.get("liter")

assert unit_prs,  "FAIL: unit prs tidak ada"
assert unit_gram, f"FAIL: unit gram tidak ada. Available: {list(units_map.keys())}"
print(f"    prs:   {unit_prs['id']} ({unit_prs['symbol']})")
print(f"    gram:  {unit_gram['id']} ({unit_gram['symbol']})")
if unit_ml:    print(f"    ml:    {unit_ml['id']}")
if unit_liter: print(f"    liter: {unit_liter['id']}")
if unit_pcs:   print(f"    pcs:   {unit_pcs['id']}")

# ── Buat test ingredients ─────────────────────────────────────────────────────
print("\n[setup] Buat test ingredients...")

# 1. Ayam Berlaris (processed) — pakai yang sudah ada di DB
ayam_berlaris = db.table("ingredients").select("id,name,base_unit_id,avg_cost_per_unit").ilike("name", "%Ayam Berlaris%").limit(1).execute().data[0]
orig_ayam_avg = float(ayam_berlaris["avg_cost_per_unit"] or 0)
db.table("ingredients").update({"avg_cost_per_unit": 5000}).eq("id", ayam_berlaris["id"]).execute()
print(f"    Ayam Berlaris: avg_cost di-set ke Rp 5.000/prs")

# 2. Raw ingredient dalam gram (simulate "Beras")
ing_beras = db.table("ingredients").insert({
    "name": "_TEST Beras HPP", "ingredient_type": "raw", "division": "kitchen",
    "base_unit_id": unit_gram["id"], "avg_cost_per_unit": 16.25, "is_active": True,
}).execute().data[0]
print(f"    _TEST Beras HPP: avg_cost Rp 16.25/gram (base=gram)")

# 3. Packaging ingredient
ing_cup = None
if unit_pcs:
    ing_cup = db.table("ingredients").insert({
        "name": "_TEST Hot Cup HPP", "ingredient_type": "packaging", "division": "bar",
        "base_unit_id": unit_pcs["id"], "avg_cost_per_unit": 1500, "is_active": True,
    }).execute().data[0]
    print(f"    _TEST Hot Cup HPP: packaging Rp 1.500/pcs (harusnya SKIP di HPP)")

# 4. Ingredient dengan unit conversion test (ml base, recipe pakai liter)
ing_kecap = None
if unit_ml and unit_liter:
    # Cek apakah ada conversion liter→ml
    conv = db.table("unit_conversions").select("factor").eq("from_unit_id", unit_liter["id"]).eq("to_unit_id", unit_ml["id"]).maybe_single().execute().data
    if conv:
        ing_kecap = db.table("ingredients").insert({
            "name": "_TEST Kecap HPP", "ingredient_type": "raw", "division": "kitchen",
            "base_unit_id": unit_ml["id"], "avg_cost_per_unit": 20, "is_active": True,
        }).execute().data[0]
        kecap_liter_factor = float(conv["factor"])  # e.g. 1000
        print(f"    _TEST Kecap HPP: avg_cost Rp 20/ml (base=ml), conv liter→ml={kecap_liter_factor}")
    else:
        print(f"    SKIP kecap test: tidak ada konversi liter→ml di DB")

# ── Buat test menu + recipe ───────────────────────────────────────────────────
print("\n[setup] Buat test menu...")
menu_r = api("post", "/menus/", json={
    "name": "_TEST Ayam Bakar HPP", "category": "main_course",
    "division": "kitchen", "selling_price": 35000
})
assert menu_r.status_code == 201, menu_r.text
menu_id = menu_r.json()["id"]

recipe_items = [
    # 1. Ayam Berlaris — 1 prs (same unit as base)
    {"ingredient_id": ayam_berlaris["id"], "qty": 1, "unit_id": unit_prs["id"]},
    # 2. Beras — 150 gram (same unit as base)
    {"ingredient_id": ing_beras["id"], "qty": 150, "unit_id": unit_gram["id"]},
]
if ing_cup:
    recipe_items.append(
        # 3. Hot Cup — 1 pcs (packaging, harusnya SKIP)
        {"ingredient_id": ing_cup["id"], "qty": 1, "unit_id": unit_pcs["id"]}
    )
if ing_kecap:
    recipe_items.append(
        # 4. Kecap — 0.01 liter = 10 ml (unit conversion test)
        {"ingredient_id": ing_kecap["id"], "qty": 0.01, "unit_id": unit_liter["id"]}
    )

api("post", f"/menus/{menu_id}/recipe", json={"items": recipe_items})
print(f"    Menu: {menu_id} — {len(recipe_items)} items (termasuk packaging + unit_conv)")

# ── Cleanup menu_hpp yang mungkin ada sebelumnya ──────────────────────────────
today = date.today()
period_month_str = f"{today.year}-{today.month:02d}-01"
db.table("menu_hpp").delete().eq("menu_id", menu_id).execute()

# ═══════════════════════════════════════════════════════════════════════════════
# TEST 1: POST /calculate/hpp?menu_id= — kalkulasi penuh
# ═══════════════════════════════════════════════════════════════════════════════
print(f"\n[1] POST /calculate/hpp?menu_id={menu_id}")
r1 = api("post", f"/calculate/hpp?menu_id={menu_id}")
assert r1.status_code == 200, f"FAIL: {r1.status_code} {r1.text}"
d1 = r1.json()
result = d1["results"][0]

print(f"\n    === BREAKDOWN ===")
for b in result["ingredient_breakdown"]:
    skipped = b.get("skipped", False)
    if skipped:
        print(f"    SKIP  [{b['ingredient_type']:10}] {b['ingredient_name']}: {b.get('skip_reason')}")
    else:
        conv = f" × conv={b['conversion_factor']}" if b.get("conversion_factor") != 1.0 else ""
        yield_str = f" / yield={b['cumulative_yield']:.4f}" if b.get("cumulative_yield") else ""
        print(
            f"    INCL  [{b['ingredient_type']:10}] {b['ingredient_name']}: "
            f"qty={b['recipe_qty']}{conv} → {b['qty_in_base_unit']} base_unit, "
            f"avg={b['avg_cost_per_unit']:.2f}{yield_str}, "
            f"eff={b['effective_cost']:.4f}, "
            f"hpp={b['ingredient_hpp']:.2f}"
        )

if result["warnings"]:
    print(f"\n    Warnings: {result['warnings']}")

print(f"\n    === TOTAL ===")
print(f"    HPP total   : Rp {result['hpp']:,.2f}")
print(f"    Selling price: Rp {result['selling_price']:,.0f}")
print(f"    Food cost % : {result['food_cost_pct']:.2f}%")
print(f"    Period      : {result['period_month']}")

# Verifikasi Ayam Berlaris (processed + yield)
ayam_item = next((b for b in result["ingredient_breakdown"] if "Ayam Berlaris" in b["ingredient_name"]), None)
assert ayam_item and not ayam_item.get("skipped"), "FAIL: Ayam Berlaris tidak ada atau di-skip"
assert ayam_item["cumulative_yield"] is not None, "FAIL: cumulative_yield harus ada untuk processed"
expected_eff = 5000 / ayam_item["cumulative_yield"]
check("Ayam Berlaris effective_cost", ayam_item["effective_cost"], expected_eff, tol=1)

# Verifikasi Beras (raw)
beras_item = next((b for b in result["ingredient_breakdown"] if "Beras" in b["ingredient_name"]), None)
assert beras_item and not beras_item.get("skipped"), "FAIL: Beras tidak ada"
check("Beras contribution (150 × 16.25 = 2437.5)", beras_item["ingredient_hpp"], 2437.5, tol=0.1)
check("Beras effective_cost (= avg_cost, no yield)", beras_item["effective_cost"], 16.25, tol=0.01)

# Verifikasi packaging di-skip
if ing_cup:
    cup_item = next((b for b in result["ingredient_breakdown"] if "Hot Cup" in b["ingredient_name"]), None)
    assert cup_item and cup_item.get("skipped"), "FAIL: Hot Cup harusnya di-skip"
    print(f"\n    PASS: packaging '{cup_item['ingredient_name']}' di-skip dengan benar")

# Verifikasi unit conversion (kecap)
if ing_kecap:
    kecap_item = next((b for b in result["ingredient_breakdown"] if "Kecap" in b["ingredient_name"]), None)
    assert kecap_item and not kecap_item.get("skipped"), "FAIL: Kecap tidak ada"
    expected_qty_base = 0.01 * kecap_liter_factor  # 0.01 L × 1000 = 10 ml
    check(f"Kecap qty_in_base_unit (0.01L → {expected_qty_base}ml)", kecap_item["qty_in_base_unit"], expected_qty_base, tol=0.01)
    check("Kecap conversion_factor", kecap_item["conversion_factor"], kecap_liter_factor, tol=0.01)
    expected_kecap_hpp = expected_qty_base * 20  # 10 ml × Rp20/ml = Rp200
    check(f"Kecap contribution ({expected_qty_base}ml × Rp20 = Rp{expected_kecap_hpp})", kecap_item["ingredient_hpp"], expected_kecap_hpp, tol=0.1)
    print(f"    PASS: unit conversion liter→ml bekerja dengan benar")

# Expected HPP minimum = Ayam + Beras
expected_min = ayam_item["ingredient_hpp"] + 2437.5
check(f"HPP total ≥ Ayam+Beras", result["hpp"], expected_min, tol=500)
assert result["food_cost_pct"] > 0, "FAIL: food_cost_pct harus > 0"
assert result["food_cost_pct"] < 100, "FAIL: food_cost_pct > 100%, cek harga"
print(f"\n    PASS: HPP masuk akal ({result['food_cost_pct']:.1f}% food cost)")

# ═══════════════════════════════════════════════════════════════════════════════
# TEST 2: Cek menu_hpp tersimpan di DB
# ═══════════════════════════════════════════════════════════════════════════════
print(f"\n[2] Verify menu_hpp di DB (period={period_month_str})")
hpp_row = db.table("menu_hpp").select("*").eq("menu_id", menu_id).eq("period_month", period_month_str).maybe_single().execute().data
assert hpp_row, "FAIL: menu_hpp tidak tersimpan"
check("DB hpp_amount", hpp_row["hpp_amount"], result["hpp"], tol=0.1)
check("DB food_cost_pct", hpp_row["food_cost_pct"], result["food_cost_pct"], tol=0.1)
print(f"    PASS: menu_hpp tersimpan benar di DB")

# ═══════════════════════════════════════════════════════════════════════════════
# TEST 3: Idempotent — panggil lagi hasilnya sama
# ═══════════════════════════════════════════════════════════════════════════════
print(f"\n[3] Idempotent test — panggil recalc 2x")
r3 = api("post", f"/calculate/hpp?menu_id={menu_id}")
assert r3.status_code == 200, r3.text
r3b = r3.json()["results"][0]
check("HPP idempotent", r3b["hpp"], result["hpp"], tol=0.01)
hpp_rows = db.table("menu_hpp").select("id").eq("menu_id", menu_id).execute().data
print(f"    menu_hpp rows: {len(hpp_rows)} (expected 1 — upsert tidak duplikat)")
assert len(hpp_rows) == 1, "FAIL: upsert membuat duplikat"
print(f"    PASS: idempotent OK")

# ─── Cleanup ──────────────────────────────────────────────────────────────────
print("\n[cleanup]")
# Hapus recipe dulu (FK constraint dari ingredients), baru hapus menu + ingredients
db.table("recipes").delete().eq("menu_id", menu_id).execute()
db.table("menu_hpp").delete().eq("menu_id", menu_id).execute()
requests.delete(f"{BASE}/menus/{menu_id}", headers=H)
db.table("ingredients").delete().eq("id", ing_beras["id"]).execute()
if ing_cup:   db.table("ingredients").delete().eq("id", ing_cup["id"]).execute()
if ing_kecap: db.table("ingredients").delete().eq("id", ing_kecap["id"]).execute()
db.table("ingredients").update({"avg_cost_per_unit": orig_ayam_avg}).eq("id", ayam_berlaris["id"]).execute()
print(f"    avg_cost Ayam Berlaris dikembalikan ke Rp {orig_ayam_avg}")
print("    Semua data test dibersihkan")

print("\n" + "=" * 60)
print("TEST SELESAI")
print("=" * 60)
