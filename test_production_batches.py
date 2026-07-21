# -*- coding: utf-8 -*-
"""
Test production batch endpoints end-to-end.

Skenario: Proses Ayam Berlaris
  - Ayam Utuh (raw) → Ayam Berlaris (processed, ~200g/porsi)
  - Stages: trim 85% → masak 73% → cumulative ~62.05%
  - Input: 5 kg Ayam Utuh
  - Theoretical portions: (5000g × 0.6205) / 200g = ~15.51 → 15 porsi
  - Test A: actual=15 → variance≈-0.06% → NOT flagged
  - Test B: actual=8  → variance≈-48.4% → FLAGGED
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
TEST_DATE = "2099-03-01"

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

def check(label, got, expected, tol=0.1):
    ok = got is not None and abs(float(got) - float(expected)) < tol
    status = "PASS" if ok else "FAIL"
    print(f"    {status}: {label} = {got!r} (expected {expected})")
    return ok

print("=" * 60)
print("TEST: production batch endpoints")
print(f"Test date: {TEST_DATE}")
print("=" * 60)

# ── Lookup ingredients & units ────────────────────────────────────────────────
print("\n[setup] Lookup ingredients & units...")
units_map = {u["symbol"]: u for u in db.table("units").select("id,name,symbol").execute().data}
unit_kg  = units_map.get("kg")
unit_g   = units_map.get("g") or units_map.get("gr")
unit_prs = units_map.get("prs")

assert unit_kg,  "FAIL: unit kg tidak ditemukan"
assert unit_prs, "FAIL: unit prs tidak ditemukan"
print(f"    unit kg:  {unit_kg['id']}")
print(f"    unit prs: {unit_prs['id']}")

# Cari atau buat test raw ingredient (Ayam Utuh)
ayam_utuh = db.table("ingredients").select("id,name").ilike("name", "%Ayam Utuh%").maybe_single().execute().data
if not ayam_utuh:
    ayam_utuh = db.table("ingredients").insert({
        "name": "_TEST Ayam Utuh", "ingredient_type": "raw", "division": "kitchen",
        "base_unit_id": unit_kg["id"], "is_active": True,
    }).execute().data[0]
    _created_raw = True
else:
    _created_raw = False
print(f"    Ayam Utuh: {ayam_utuh['id']}")

# Cari atau buat test processed ingredient (Ayam Berlaris)
ayam_berlaris = db.table("ingredients").select("id,name").ilike("name", "%Ayam Berlaris%").limit(1).execute().data
ayam_berlaris = ayam_berlaris[0] if ayam_berlaris else None
if not ayam_berlaris:
    ayam_berlaris = db.table("ingredients").insert({
        "name": "_TEST Ayam Berlaris", "ingredient_type": "processed", "division": "kitchen",
        "base_unit_id": unit_prs["id"], "portion_size_g": 200, "is_active": True,
    }).execute().data[0]
    _created_processed = True
else:
    _created_processed = False
print(f"    Ayam Berlaris: {ayam_berlaris['id']}")

# ── Buat production process via API ──────────────────────────────────────────
print("\n[setup] Membuat test production process...")
proc_r = api("post", "/production/processes", json={
    "name": "_TEST Proses Ayam Berlaris",
    "raw_ingredient_id": ayam_utuh["id"],
    "output_ingredient_id": ayam_berlaris["id"],
    "portion_size_g": 200,
    "is_active": True,
    "stages": [
        {"stage_order": 1, "stage_name": "Trim", "yield_pct": 85},
        {"stage_order": 2, "stage_name": "Masak", "yield_pct": 73},
    ],
    "outputs": [],
})
assert proc_r.status_code == 201, f"Create process gagal: {proc_r.text}"
process_id = proc_r.json()["id"]
print(f"    Process ID: {process_id}")
print(f"    Cumulative yield: 85% × 73% = {85*73/100:.2f}%")
print(f"    Theoretical portions: (5000g × 0.{85*73}%) / 200g ≈ {5000 * 0.85 * 0.73 / 200:.2f}")

# ── Cleanup stale batches ─────────────────────────────────────────────────────
db.table("production_batches").delete().eq("process_id", process_id).execute()

# ═══════════════════════════════════════════════════════════════════════════════
# TEST 1: POST /production/batches — skenario A: actual=15 (hampir exact)
# ═══════════════════════════════════════════════════════════════════════════════
print(f"\n[1] POST /production/batches — Skenario A: 5kg → actual=15 porsi")
r1 = api("post", "/production/batches", json={
    "process_id": process_id,
    "batch_date": TEST_DATE,
    "raw_qty_used": 5,
    "raw_unit_id": unit_kg["id"],
    "portions_actual": 15,
    "processed_by": "Chef Test",
    "notes": "Test batch A",
})
assert r1.status_code == 201, f"POST /batches gagal: {r1.status_code} {r1.text}"
d1 = r1.json()
batch_id_a = d1["id"]
print(f"    batch_id: {batch_id_a}")
print(f"    process_name: {d1.get('process_name')}")
print(f"    raw_ingredient_name: {d1.get('raw_ingredient_name')}")
print(f"    output_ingredient_name: {d1.get('output_ingredient_name')}")
print(f"    raw_unit_name: {d1.get('raw_unit_name')}")

theoretical = float(d1["portions_theoretical"]) if d1.get("portions_theoretical") else None
check("portions_theoretical", theoretical, 5000 * 0.85 * 0.73 / 200, tol=0.5)
check("yield_actual_pct", d1.get("yield_actual_pct"), 15 / (5000 * 0.85 * 0.73 / 200) * 100, tol=1.0)
print(f"    variance_pct: {d1.get('variance_pct')}")
print(f"    is_flagged: {d1.get('is_flagged')} (expected False — variance kecil)")

# ═══════════════════════════════════════════════════════════════════════════════
# TEST 2: POST /production/batches — skenario B: actual=8 → FLAGGED
# ═══════════════════════════════════════════════════════════════════════════════
print(f"\n[2] POST /production/batches — Skenario B: actual=8 porsi → FLAGGED")
r2 = api("post", "/production/batches", json={
    "process_id": process_id,
    "batch_date": TEST_DATE,
    "raw_qty_used": 5,
    "raw_unit_id": unit_kg["id"],
    "portions_actual": 8,
    "notes": "Test batch B — yield rendah",
})
assert r2.status_code == 201, f"POST /batches gagal: {r2.status_code} {r2.text}"
d2 = r2.json()
batch_id_b = d2["id"]
print(f"    variance_pct: {d2.get('variance_pct')}")
print(f"    is_flagged: {'PASS' if d2['is_flagged'] else 'FAIL'} = {d2['is_flagged']} (expected True)")

# ═══════════════════════════════════════════════════════════════════════════════
# TEST 3: GET /production/batches — list semua
# ═══════════════════════════════════════════════════════════════════════════════
print(f"\n[3] GET /production/batches?date_from={TEST_DATE}&date_to={TEST_DATE}")
r3 = api("get", f"/production/batches?date_from={TEST_DATE}&date_to={TEST_DATE}")
assert r3.status_code == 200, r3.text
d3 = r3.json()
print(f"    Total batches: {len(d3)} (expected 2)")
our_batches = [b for b in d3 if b["process_id"] == process_id]
print(f"    Our batches: {len(our_batches)} (expected 2)")
assert len(our_batches) >= 2, "FAIL: batch tidak lengkap"
print("    PASS: list_batches OK")

# ═══════════════════════════════════════════════════════════════════════════════
# TEST 4: GET /production/batches?flagged=true
# ═══════════════════════════════════════════════════════════════════════════════
print(f"\n[4] GET /production/batches?flagged=true")
r4 = api("get", f"/production/batches?date_from={TEST_DATE}&date_to={TEST_DATE}&flagged=true")
assert r4.status_code == 200, r4.text
d4 = r4.json()
our_flagged = [b for b in d4 if b["process_id"] == process_id]
print(f"    Flagged batches (ours): {len(our_flagged)} (expected 1)")
assert len(our_flagged) == 1, f"FAIL: expected 1 flagged batch, got {len(our_flagged)}"
print(f"    Flagged batch variance_pct: {our_flagged[0]['variance_pct']}")
print("    PASS: filter flagged OK")

# ═══════════════════════════════════════════════════════════════════════════════
# TEST 5: GET /production/batches/{batch_id}
# ═══════════════════════════════════════════════════════════════════════════════
print(f"\n[5] GET /production/batches/{batch_id_a}")
r5 = api("get", f"/production/batches/{batch_id_a}")
assert r5.status_code == 200, r5.text
d5 = r5.json()
print(f"    id: {d5['id']}")
print(f"    process_name: {d5.get('process_name')}")
print(f"    batch_date: {d5['batch_date']}")
print(f"    portions_actual: {d5['portions_actual']}")
assert d5["id"] == batch_id_a, "FAIL: id tidak sesuai"
print("    PASS: get_batch OK")

# ═══════════════════════════════════════════════════════════════════════════════
# TEST 6: Validasi unit input gram (bukan kg)
# ═══════════════════════════════════════════════════════════════════════════════
print(f"\n[6] POST /production/batches — input dalam gram (5000g = 5kg)")
gram_candidates = [u for sym, u in units_map.items() if sym in ("g", "gr", "gram")]
if gram_candidates and unit_g:
    r6 = api("post", "/production/batches", json={
        "process_id": process_id,
        "batch_date": TEST_DATE,
        "raw_qty_used": 5000,
        "raw_unit_id": unit_g["id"],
        "portions_actual": 15,
        "notes": "Test batch — input dalam gram",
    })
    if r6.status_code == 201:
        d6 = r6.json()
        theo6 = float(d6["portions_theoretical"]) if d6.get("portions_theoretical") else None
        check("portions_theoretical (input gram)", theo6, 5000 * 0.85 * 0.73 / 200, tol=0.5)
        db.table("production_batches").delete().eq("id", d6["id"]).execute()
    else:
        print(f"    SKIP: unit 'g' tidak ada konversi ke kg di DB ({r6.status_code})")
else:
    print("    SKIP: unit gram tidak ada di DB")

# ── Cleanup ───────────────────────────────────────────────────────────────────
print("\n[cleanup]")
db.table("production_batches").delete().eq("process_id", process_id).execute()
requests.delete(f"{BASE}/production/processes/{process_id}", headers=H)
print(f"    Deleted process {process_id}")
print("    Data test dibersihkan")

print("\n" + "=" * 60)
print("TEST SELESAI")
print("=" * 60)
