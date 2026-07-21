# -*- coding: utf-8 -*-
"""
Test opname system end-to-end.

Skenario:
  Test date: 2099-01-02 (isolated)

  Setup:
  - Ayam Berlaris: opname kemarin (2099-01-01) = 50 porsi  (opening)
  - Sales hari ini: Ayam Bakar 10 porsi → theoretical_out = 10 porsi Ayam Berlaris
  - Opname hari ini: Ayam Berlaris = 38 porsi (actual_closing)

  Expected variance:
    theoretical_closing = 50 + 0 - 10 = 40 porsi
    variance_qty        = 38 - 40     = -2 porsi
    variance_pct        = -2/40 * 100 = -5.0%
    is_flagged          = False  (|−5.0| = 5.0, threshold is > 5.0 strict)

  Skenario B: Ayam Berlaris = 30 → variance_pct = -25% → is_flagged = True
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

BASE       = "http://localhost:8000"
TEST_DATE  = "2099-01-02"
PREV_DATE  = "2099-01-01"

db = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])

ADMIN_EMAIL    = os.environ.get("TEST_ADMIN_EMAIL", "admin@berlaris.com")
ADMIN_PASSWORD = os.environ.get("TEST_ADMIN_PASSWORD")
if not ADMIN_PASSWORD:
    sys.exit("TEST_ADMIN_PASSWORD belum di-set — isi di .env.test (root project) atau env var.")

# ── Auth ──────────────────────────────────────────────────────────────────────
r = requests.post(f"{BASE}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
token = r.json()["access_token"]
H  = {"Authorization": f"Bearer {token}"}
HJ = {**H, "Content-Type": "application/json"}

def api(method, path, **kw):
    return getattr(requests, method)(f"{BASE}{path}", headers=HJ, **kw)

def check(label, got, expected, tol=0.01):
    ok = got is not None and abs(float(got) - float(expected)) < tol
    print(f"    {'PASS' if ok else 'FAIL'}: {label} = {got} (expected {expected})")
    return ok

print("=" * 60)
print("TEST: opname system")
print(f"Test date: {TEST_DATE}")
print("=" * 60)

# ── Lookup ────────────────────────────────────────────────────────────────────
print("\n[setup] Lookup...")
ayam_berlaris = db.table("ingredients").select("id,name,base_unit_id").eq("is_active", True).ilike("name", "%Ayam Berlaris%").limit(1).execute().data[0]
units_map = {u["symbol"]: u for u in db.table("units").select("id,name,symbol").execute().data}
unit_porsi = units_map["prs"]
print(f"    Ayam Berlaris: {ayam_berlaris['id']}")
print(f"    unit porsi: {unit_porsi['id']}")

# ── Clean state ───────────────────────────────────────────────────────────────
db.table("daily_stock_opname").delete().eq("opname_date", TEST_DATE).execute()
db.table("daily_stock_opname").delete().eq("opname_date", PREV_DATE).execute()
db.table("daily_sales_entries").delete().eq("entry_date", TEST_DATE).execute()
db.table("theoretical_consumption").delete().eq("consumption_date", TEST_DATE).execute()
db.table("variance_reports").delete().eq("report_date", TEST_DATE).execute()

# ── Setup: test menu + recipe ─────────────────────────────────────────────────
menu = api("post", "/menus/", json={
    "name": "_TEST Ayam Bakar Opname", "category": "main_course",
    "division": "kitchen", "selling_price": 45000
})
assert menu.status_code == 201, menu.text
menu_id = menu.json()["id"]

api("post", f"/menus/{menu_id}/recipe", json={"items": [
    {"ingredient_id": ayam_berlaris["id"], "qty": 1, "unit_id": unit_porsi["id"]}
]})

# Opname kemarin = 50 porsi (opening stock)
db.table("daily_stock_opname").insert({
    "opname_date": PREV_DATE,
    "ingredient_id": ayam_berlaris["id"],
    "physical_qty": 50,
    "unit_id": unit_porsi["id"],
}).execute()
print("    Opening stock (kemarin) = 50 porsi Ayam Berlaris")

# Sales hari ini: 10 porsi Ayam Bakar → theoretical_out = 10 porsi Ayam Berlaris
sales_r = api("post", "/sales-entry/", json={
    "entry_date": TEST_DATE,
    "entries": [{"menu_id": menu_id, "qty_sold": 10}]
})
assert sales_r.status_code == 200, sales_r.text
print(f"    Sales: Ayam Bakar 10 porsi → theoretical_out recalculated")

# Verify theoretical_consumption
theo = db.table("theoretical_consumption").select("consumed_qty").eq("consumption_date", TEST_DATE).eq("ingredient_id", ayam_berlaris["id"]).limit(1).execute().data
print(f"    theoretical_consumption: {float(theo[0]['consumed_qty']) if theo else 'MISSING'} porsi (expected 10)")

# ═══════════════════════════════════════════════════════════════════════════════
# TEST 1: GET /opname/today
# ═══════════════════════════════════════════════════════════════════════════════
print(f"\n[1] GET /opname/today?opname_date={TEST_DATE}")
r1 = api("get", f"/opname/today?opname_date={TEST_DATE}")
assert r1.status_code == 200, r1.text
data1 = r1.json()
print(f"    total_ingredients: {data1['total_ingredients']}")
print(f"    total_counted: {data1['total_counted']}")
print(f"    divisions: {[g['division'] for g in data1['groups']]}")

# Ayam Berlaris harus ada dengan physical_qty=None (belum di-count)
all_ings = [i for g in data1["groups"] for i in g["ingredients"]]
ayam_item = next((i for i in all_ings if i["ingredient_id"] == ayam_berlaris["id"]), None)
assert ayam_item, "FAIL: Ayam Berlaris tidak ada di opname today response"
print(f"    Ayam Berlaris.physical_qty = {ayam_item['physical_qty']} (expected None/null — belum di-count)")
assert ayam_item["physical_qty"] is None, "FAIL: seharusnya belum di-count"
print("    PASS: GET /opname/today OK")

# ═══════════════════════════════════════════════════════════════════════════════
# TEST 2: POST /opname — skenario A: actual=38, expected variance=-5.0%
# ═══════════════════════════════════════════════════════════════════════════════
print(f"\n[2] POST /opname — Skenario A: actual=38 → variance=-5.0% (tidak flagged)")
r2 = api("post", "/opname/", json={
    "opname_date": TEST_DATE,
    "counts": [
        {"ingredient_id": ayam_berlaris["id"], "physical_qty": 38, "unit_id": unit_porsi["id"]}
    ]
})
assert r2.status_code == 200, f"POST /opname gagal: {r2.status_code} {r2.text}"
d2 = r2.json()
print(f"    saved: {d2['saved']}, flagged: {d2['flagged']}")
print(f"    variance_summary ({len(d2['variance_summary'])} items):")

# Cek variance di DB
var_row = db.table("variance_reports").select("*").eq("report_date", TEST_DATE).eq("ingredient_id", ayam_berlaris["id"]).limit(1).execute().data
assert var_row, "FAIL: tidak ada variance_reports row"
v = var_row[0]
print(f"\n    variance_reports:")
print(f"      opening_qty        = {v['opening_qty']} (expected 50)")
print(f"      theoretical_out    = {v['theoretical_out_qty']} (expected 10)")
print(f"      theoretical_closing= {v['theoretical_closing']} (expected 40)")
print(f"      actual_closing     = {v['actual_closing_qty']} (expected 38)")
print(f"      variance_qty       = {v['variance_qty']} (expected -2)")
print(f"      variance_pct       = {v['variance_pct']} (expected -5.0)")
print(f"      is_flagged         = {v['is_flagged']} (expected False)")

passed2 = all([
    check("opening_qty",         v["opening_qty"],         50.0),
    check("theoretical_closing", v["theoretical_closing"], 40.0),
    check("actual_closing_qty",  v["actual_closing_qty"],  38.0),
    check("variance_qty",        v["variance_qty"],        -2.0),
    check("variance_pct",        v["variance_pct"],        -5.0),
    v["is_flagged"] == False,
])
print(f"    is_flagged: PASS = {not v['is_flagged']} (expected False)")

# ═══════════════════════════════════════════════════════════════════════════════
# TEST 3: POST /opname — skenario B: actual=30 → variance=-25% → FLAGGED
# ═══════════════════════════════════════════════════════════════════════════════
print(f"\n[3] POST /opname — Skenario B: actual=30 → variance=-25% → FLAGGED")
r3 = api("post", "/opname/", json={
    "opname_date": TEST_DATE,
    "counts": [
        {"ingredient_id": ayam_berlaris["id"], "physical_qty": 30, "unit_id": unit_porsi["id"]}
    ]
})
assert r3.status_code == 200, r3.text
d3 = r3.json()
print(f"    saved: {d3['saved']}, flagged: {d3['flagged']} (expected >=1)")

var_row2 = db.table("variance_reports").select("variance_pct,is_flagged,actual_closing_qty").eq("report_date", TEST_DATE).eq("ingredient_id", ayam_berlaris["id"]).limit(1).execute().data[0]
check("actual_closing (skenario B)", var_row2["actual_closing_qty"], 30.0)
check("variance_pct (skenario B)",   var_row2["variance_pct"],       -25.0)
print(f"    is_flagged: {'PASS' if var_row2['is_flagged'] else 'FAIL'} = {var_row2['is_flagged']} (expected True)")

# ═══════════════════════════════════════════════════════════════════════════════
# TEST 4: GET /opname/today setelah submit — physical_qty harus ada
# ═══════════════════════════════════════════════════════════════════════════════
print(f"\n[4] GET /opname/today setelah submit")
r4 = api("get", f"/opname/today?opname_date={TEST_DATE}")
data4 = r4.json()
all_ings4 = [i for g in data4["groups"] for i in g["ingredients"]]
ayam4 = next((i for i in all_ings4 if i["ingredient_id"] == ayam_berlaris["id"]), None)
print(f"    total_counted: {data4['total_counted']} (expected >= 1)")
print(f"    Ayam Berlaris.physical_qty = {ayam4['physical_qty']} (expected 30.0)")
assert ayam4 and ayam4["physical_qty"] is not None, "FAIL: physical_qty masih None"
print("    PASS: physical_qty muncul setelah submit")

# ═══════════════════════════════════════════════════════════════════════════════
# TEST 5: GET /opname/history
# ═══════════════════════════════════════════════════════════════════════════════
print(f"\n[5] GET /opname/history")
r5 = api("get", f"/opname/history?date_from={TEST_DATE}&date_to={TEST_DATE}")
assert r5.status_code == 200, r5.text
hist = r5.json()
print(f"    Total rows: {len(hist)}")
row = next((h for h in hist if h["ingredient_id"] == ayam_berlaris["id"]), None)
assert row, "FAIL: Ayam Berlaris tidak ada di history"
print(f"    Ayam Berlaris: variance_pct={row['variance_pct']}, is_flagged={row['is_flagged']}, name={row['ingredient_name']}")
print("    PASS: history OK")

# ═══════════════════════════════════════════════════════════════════════════════
# TEST 6: POST /calculate/variance endpoint
# ═══════════════════════════════════════════════════════════════════════════════
print(f"\n[6] POST /calculate/variance?date=")
r6 = api("post", f"/calculate/variance?date={TEST_DATE}")
assert r6.status_code == 200, r6.text
d6 = r6.json()
print(f"    ingredients_calculated: {d6['ingredients_calculated']}")
print(f"    flagged: {d6['flagged']}")
assert d6["ingredients_calculated"] >= 1, "FAIL"
print("    PASS: calculate/variance endpoint OK")

# ── Cleanup ───────────────────────────────────────────────────────────────────
print("\n[cleanup]")
requests.delete(f"{BASE}/menus/{menu_id}", headers=H)
db.table("daily_stock_opname").delete().eq("opname_date", TEST_DATE).execute()
db.table("daily_stock_opname").delete().eq("opname_date", PREV_DATE).execute()
db.table("daily_sales_entries").delete().eq("entry_date", TEST_DATE).execute()
db.table("theoretical_consumption").delete().eq("consumption_date", TEST_DATE).execute()
db.table("variance_reports").delete().eq("report_date", TEST_DATE).execute()
print("    Data test dibersihkan")

print("\n" + "=" * 60)
print("TEST SELESAI")
print("=" * 60)
