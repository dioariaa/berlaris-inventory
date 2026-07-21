# -*- coding: utf-8 -*-
"""
Test calculate_theoretical_consumption + unit conversion.

Pakai tanggal isolasi 2099-01-01 agar tidak clash dengan data produksi.

Skenario 1: same unit — Ayam Bakar 10 porsi, BOM 1 porsi Ayam Berlaris
  expected: consumed = 10.0 porsi

Skenario 2: unit conversion kg → gram
  Ayam Utuh base_unit = gram (g)
  BOM: 0.5 kg per porsi, qty_sold = 4
  expected: consumed = 4 × 0.5 × 1000 = 2000.0 gram

Skenario 3: POST /calculate/theoretical-consumption?date= endpoint idempoten

Skenario 4: zero sales — theoretical_consumption dibersihkan
"""
import os, sys, requests
sys.stdout.reconfigure(encoding="utf-8")
from pathlib import Path
from dotenv import load_dotenv
from supabase import create_client

ROOT = Path(__file__).resolve().parent
load_dotenv(ROOT / "backend" / ".env")  # SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
load_dotenv(ROOT / ".env.test")         # TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD

BASE      = "http://localhost:8000"
TEST_DATE = "2099-01-01"   # tanggal isolasi, tidak ada data produksi

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

print("=" * 60)
print("TEST: theoretical_consumption + unit conversion")
print(f"Test date: {TEST_DATE}  (isolated, no production data)")
print("=" * 60)

# ── Helpers ───────────────────────────────────────────────────────────────────

def api(method, path, **kw):
    fn = getattr(requests, method)
    r = fn(f"{BASE}{path}", headers=HJ, **kw)
    return r

def create_menu(name, category="main_course", division="kitchen", price=45000):
    r = api("post", "/menus/", json={
        "name": name, "category": category,
        "division": division, "selling_price": price,
    })
    assert r.status_code == 201, f"Create menu gagal: {r.status_code} {r.text}"
    return r.json()

def set_recipe(menu_id, items):
    r = api("post", f"/menus/{menu_id}/recipe", json={"items": items})
    assert r.status_code in (200, 201), f"Set recipe gagal: {r.status_code} {r.text}"

def submit_sales(entries_list):
    r = api("post", "/sales-entry/", json={"entry_date": TEST_DATE, "entries": entries_list})
    assert r.status_code == 200, f"Submit sales gagal: {r.status_code} {r.text}"
    return r.json()

def recalc(date=TEST_DATE):
    r = api("post", "/calculate/theoretical-consumption", params={"date": date})
    assert r.status_code == 200, f"Recalc gagal: {r.status_code} {r.text}"
    return r.json()

def query_consumed(ingredient_id):
    try:
        rows = (
            db.table("theoretical_consumption")
            .select("consumed_qty, unit_id")
            .eq("consumption_date", TEST_DATE)
            .eq("ingredient_id", ingredient_id)
            .limit(1)
            .execute()
            .data
        )
        return float(rows[0]["consumed_qty"]) if rows else None
    except Exception:
        return None

def check(label, got, expected, tol=0.001):
    if got is not None and abs(got - expected) < tol:
        print(f"    PASS: {label} = {got}")
        return True
    else:
        print(f"    FAIL: {label} — expected {expected}, got {got}")
        return False

# ── Lookup ────────────────────────────────────────────────────────────────────

print("\n[setup] Lookup ingredients & units...")

# Ingredients
ayam_berlaris = db.table("ingredients").select("id,name,base_unit_id").eq("is_active", True).ilike("name", "%Ayam Berlaris%").limit(1).execute().data
assert ayam_berlaris, "ABORT: Ayam Berlaris tidak ditemukan"
ayam_berlaris = ayam_berlaris[0]

ayam_utuh = db.table("ingredients").select("id,name,base_unit_id").eq("is_active", True).ilike("name", "%Ayam Utuh%").limit(1).execute().data
assert ayam_utuh, "ABORT: Ayam Utuh tidak ditemukan"
ayam_utuh = ayam_utuh[0]

# Units
units = {u["symbol"]: u for u in db.table("units").select("id,name,symbol").execute().data}
unit_porsi = units.get("prs")
unit_g     = units.get("g")
unit_kg    = units.get("kg")
assert unit_porsi and unit_g and unit_kg, "ABORT: unit porsi/g/kg tidak ditemukan"

print(f"    Ayam Berlaris: base_unit={ayam_berlaris['base_unit_id']}")
print(f"    Ayam Utuh:     base_unit={ayam_utuh['base_unit_id']} (expected gram={unit_g['id']})")
print(f"    Units: porsi={unit_porsi['id']}, g={unit_g['id']}, kg={unit_kg['id']}")

# Pastikan conversion kg→g ada
conv = db.table("unit_conversions").select("factor").eq("from_unit_id", unit_kg["id"]).eq("to_unit_id", unit_g["id"]).maybe_single().execute().data
if conv:
    print(f"    Conversion kg→g: factor={conv['factor']}")
else:
    # Mungkin hanya g→kg yang ada
    rev = db.table("unit_conversions").select("factor").eq("from_unit_id", unit_g["id"]).eq("to_unit_id", unit_kg["id"]).maybe_single().execute().data
    print(f"    Conversion g→kg: factor={rev['factor'] if rev else 'MISSING'} (kg→g akan di-derive)")

# ── Test setup: bersihkan data test lama jika ada ─────────────────────────────
db.table("daily_sales_entries").delete().eq("entry_date", TEST_DATE).execute()
db.table("theoretical_consumption").delete().eq("consumption_date", TEST_DATE).execute()

created_menus = []

# ═══════════════════════════════════════════════════════════════════════════════
# SKENARIO 1: Same unit — no conversion needed
# ═══════════════════════════════════════════════════════════════════════════════
print("\n[1] Skenario 1: Ayam Bakar terjual 10 porsi, BOM = 1 porsi Ayam Berlaris")

m1 = create_menu("_TEST Ayam Bakar")
created_menus.append(m1["id"])

set_recipe(m1["id"], [
    {"ingredient_id": ayam_berlaris["id"], "qty": 1, "unit_id": unit_porsi["id"]}
])

summary = submit_sales([{"menu_id": m1["id"], "qty_sold": 10}])
print(f"    API response: ingredients_recalculated = {summary['ingredients_recalculated']}")

result = query_consumed(ayam_berlaris["id"])
passed1 = check("Ayam Berlaris consumed", result, 10.0)

# ═══════════════════════════════════════════════════════════════════════════════
# SKENARIO 2: Unit conversion kg → gram
# ═══════════════════════════════════════════════════════════════════════════════
print("\n[2] Skenario 2: Ayam Utuh BOM=0.5 kg, qty_sold=4 → expected 2000.0 gram")
print(f"    (Ayam Utuh base_unit = gram, recipe unit = kg, factor 1000)")

m2 = create_menu("_TEST Sate Ayam Utuh")
created_menus.append(m2["id"])

set_recipe(m2["id"], [
    {"ingredient_id": ayam_utuh["id"], "qty": 0.5, "unit_id": unit_kg["id"]}
])

# Submit ulang semua — recalc dipanggil otomatis di dalam POST /sales-entry
submit_sales([
    {"menu_id": m1["id"], "qty_sold": 10},
    {"menu_id": m2["id"], "qty_sold": 4},
])

result2 = query_consumed(ayam_utuh["id"])
passed2 = check("Ayam Utuh consumed (gram)", result2, 2000.0)

# Debug jika gagal
if not passed2:
    conv_rows = db.table("unit_conversions").select("from_unit_id,to_unit_id,factor").execute().data
    print("    DEBUG unit_conversions:")
    for c in conv_rows:
        f = units.get(next((k for k,v in units.items() if v["id"]==c["from_unit_id"]), ""), {}).get("symbol", c["from_unit_id"])
        t = units.get(next((k for k,v in units.items() if v["id"]==c["to_unit_id"]), ""), {}).get("symbol", c["to_unit_id"])
        print(f"      {f} → {t} = {c['factor']}")

# ═══════════════════════════════════════════════════════════════════════════════
# SKENARIO 3: Multiple menu, multiple ingredient per menu
# ═══════════════════════════════════════════════════════════════════════════════
print("\n[3] Skenario 3: BOM multi-ingredient, verifikasi Ayam Berlaris masih 10")

# Ayam Berlaris seharusnya tetap 10 (hanya m1 yang pakai)
result3 = query_consumed(ayam_berlaris["id"])
passed3 = check("Ayam Berlaris masih 10 setelah tambah m2", result3, 10.0)

# ═══════════════════════════════════════════════════════════════════════════════
# SKENARIO 4: POST /calculate/theoretical-consumption idempoten
# ═══════════════════════════════════════════════════════════════════════════════
print("\n[4] Skenario 4: recalc endpoint idempoten")

r4a = recalc()
r4b = recalc()
print(f"    Recalc #1: {r4a['ingredients_updated']} ingredients")
print(f"    Recalc #2: {r4b['ingredients_updated']} ingredients")

result4a = query_consumed(ayam_berlaris["id"])
result4b = query_consumed(ayam_utuh["id"])
passed4 = (
    check("Ayam Berlaris setelah 2× recalc", result4a, 10.0) and
    check("Ayam Utuh setelah 2× recalc", result4b, 2000.0)
)

# ═══════════════════════════════════════════════════════════════════════════════
# SKENARIO 5: Zero sales — theoretical_consumption dibersihkan
# ═══════════════════════════════════════════════════════════════════════════════
print("\n[5] Skenario 5: hapus semua sales → theoretical_consumption dibersihkan")

db.table("daily_sales_entries").delete().eq("entry_date", TEST_DATE).execute()
r5 = recalc()
print(f"    Recalc setelah clear sales: ingredients_updated = {r5['ingredients_updated']} (expected 0)")
result5 = query_consumed(ayam_berlaris["id"])
passed5 = result5 is None
print(f"    Ayam Berlaris consumption = {result5} (expected None/cleared)")
print(f"    {'PASS' if passed5 else 'FAIL'}: data dibersihkan dengan benar")

# ── Cleanup ───────────────────────────────────────────────────────────────────
print("\n[cleanup]")
for mid in created_menus:
    requests.delete(f"{BASE}/menus/{mid}", headers=H)
db.table("theoretical_consumption").delete().eq("consumption_date", TEST_DATE).execute()
print(f"    {len(created_menus)} menu test dihapus, theoretical_consumption dibersihkan")

# ── Summary ───────────────────────────────────────────────────────────────────
results = [passed1, passed2, passed3, passed4, passed5]
passed  = sum(results)
total   = len(results)
print("\n" + "=" * 60)
print(f"HASIL: {passed}/{total} skenario PASS")
if passed < total:
    labels = ["S1-basic", "S2-unit-conv", "S3-multi-ing", "S4-idempoten", "S5-zero-sales"]
    for label, ok in zip(labels, results):
        print(f"  {'OK' if ok else 'XX'} {label}")
print("=" * 60)
