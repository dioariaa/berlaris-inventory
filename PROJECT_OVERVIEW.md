# Berlaris Inventory & Cost Intelligence — Project Context (untuk analisis)

> **Cara pakai dokumen ini:** upload / paste file ini ke chat claude.ai sebagai konteks.
> Isinya ringkasan lengkap sistem (arsitektur, model data, formula bisnis, status, known issues)
> supaya Claude bisa menganalisis project tanpa akses ke repo. Dokumen ini **deskriptif** —
> bukan instruksi operasional (itu ada di `CLAUDE.md`).

---

## 1. Ringkasan satu paragraf

Sistem pengawasan berbasis web untuk owner & tim audit **Berlaris Kopi & Resto**. Tujuannya
mendeteksi **variance** antara konsumsi *teoritis* (dihitung dari penjualan × BOM/resep) vs
**stok fisik** hasil opname harian. Kalau selisihnya > 5%, sistem otomatis nge-flag — indikasi
kebocoran, waste tak tercatat, atau salah input. Sistem juga menghitung **HPP (harga pokok
penjualan) otomatis** per menu dari weighted-average cost bahan × resep, plus food-cost %.

Skala: **single-outlet**, 2 role (admin = full, owner = read-only dashboard). Bukan POS real-time
(itu rencana v2.0). Input harian dilakukan manual oleh admin (Daily Sales Entry + Stock Opname).

---

## 2. Tech stack

| Layer | Teknologi |
|---|---|
| Frontend | React + Vite + TailwindCSS + shadcn/ui (JSX, bukan TS) |
| Backend | FastAPI (Python 3.14), Pydantic v2 |
| Database | Supabase (PostgreSQL + Auth + Realtime) |
| Auth | Supabase Auth → JWT HS256 diterbitkan FastAPI, 2 role: `admin`, `owner` |
| Excel | pandas + openpyxl (bulk import BOM) |
| Deploy (rencana) | Railway/Render (API), Vercel (React) |

Client Supabase diakses **hanya** lewat `backend/app/services/supabase.py` (admin + anon client).
Tidak ada raw psycopg2.

---

## 3. Arsitektur & struktur aktual

### Backend — `backend/app/`
- `main.py` — bootstrap FastAPI + CORS (regex `http://localhost:\d+` di dev, Vercel di prod)
- `config.py` — settings (Supabase URL/keys, JWT secret, `VARIANCE_THRESHOLD = 5.0`)
- `dependencies.py` — `get_current_user`, `require_admin`, `require_owner`
- `models/` — Pydantic request/response schemas
- **`routers/` (16 file):** `auth`, `ingredients`, `units`, `menus`, `vendors`, `production`,
  `sales_entry`, `opname`, `calculate`, `dashboard`, `purchase_orders`, `goods_receipts`,
  `reports`, `waste`, `stock`, `hpp_analysis`
  → Router hanya menerima request, memanggil service, mengembalikan response.
- **`services/` (8 file) — semua business logic & formula ada di sini:**
  - `supabase.py` — client factory
  - `consumption.py` — kalkulasi `theoretical_consumption` dari sales entries
  - `variance.py` — variance harian (opname vs theoretical closing)
  - `hpp.py` — HPP per menu + food-cost % (trace-back ke raw ingredient, unit conversion)
  - `avg_cost.py` — weighted-average cost saat goods receipt
  - `yield_calc.py` — cumulative yield dari production stages
  - `stock_level.py` — current_stock (pure ledger)
  - `bulk_import.py` — parser Excel BOM (pandas)

### Frontend — `frontend/src/pages/` (20 halaman)
`Login`, `Dashboard`, `SalesEntry`, `Opname`, `ProductionBatch`, `Ingredients`, `Menus`
(CRUD menu + BOM builder), `Vendors`, `Units`, `ProductionProcesses`, `PurchaseOrders`,
`DailyPurchaseEntry` (Belanja Harian), `DailySales`, `Variance`, `Reports`, `Waste`,
`StockLevels`, `HPPManagement`, `HPPAnalysis`, `InitialStock`.
- `lib/api.js` — axios wrapper (baseURL `http://localhost:8000`, JWT interceptor, 401→/login)
- `lib/supabase.js` — Supabase client (Realtime)

---

## 4. Model data — 23 tabel (DDL: `berlaris_schema.sql`)

**Master data:** `users`, `units`, `unit_conversions`, `ingredients`, `menu_items`, `recipes`,
`vendors`, `ingredient_vendors`, `production_processes`, `production_stages`, `production_outputs`

**Operasional harian:** `daily_sales_entries`, `daily_stock_opname`, `production_batches`

**Kalkulasi (dihitung FastAPI, disimpan ke DB):** `theoretical_consumption`,
`ingredient_cost_history`, `menu_hpp`, `variance_reports`

**PO & pembelian:** `purchase_orders`, `po_items`, `goods_receipts`, `receipt_items`

**Audit:** `audit_logs`

**Tabel tambahan (via migration, bukan DDL utama):**
- `waste_logs` — bahan terbuang (reason: expired/dropped/spoiled/wrong_prep/other), dikurangkan dari theoretical closing
- `recipe_change_log` — audit trail perubahan BOM (action: `qty_change`/`ingredient_added`/`ingredient_removed`); **tidak retroaktif**; `recipe_id` nullable
- `stock_adjustments` — rekonsiliasi ledger ke opname (qty_delta + reason wajib)

**Views:** `active_menus_today`, `flagged_variance_today`, `food_cost_this_month`

### Konsep inventory dua level (penting untuk analisis)
- **Raw** = bahan beli dari vendor (ayam utuh, beras, minyak)
- **Processed** = porsi hasil produksi kitchen (Ayam Suir @20gr, Buntut @150gr) — hasil transformasi raw
- **Packaging** = kemasan (cup, straw) — **tidak masuk kalkulasi HPP**
- Resep menu memakai ingredient **processed**, bukan raw langsung.

---

## 5. Business logic inti + formula

### a. Stock real-time — PURE LEDGER (services/stock_level.py)
**Penting:** stok real-time TIDAK pakai opname sebagai anchor. Opname hanya pembanding di variance.
Akumulasi semua transaksi sejak sistem pertama dipakai; tidak ada `anchor_date`.
```
current_stock =
    SUM(receipt_items.received_qty)                              # barang masuk
  + SUM(production_batches.portions_actual)                     # output produksi
  - SUM(production_batches.raw_qty_used)                        # raw terpakai produksi
  - SUM(theoretical_consumption.consumed_qty)                   # konsumsi dari sales × BOM
  - SUM(waste_logs.qty)                                         # waste
  + SUM(stock_adjustments.qty_delta)                            # rekonsiliasi manual
is_critical = current_stock <= min_threshold
is_low      = current_stock <= min_threshold * 1.5
```

### b. Variance harian (services/variance.py) — dihitung FastAPI, bukan SQL
```
theoretical_closing =
      opening_qty (opname hari sebelumnya)
    + production_in_qty (production_batches hari ini)
    - theoretical_out_qty (daily_sales × BOM per ingredient)
    - waste_qty (waste_logs hari ini)
variance_qty = actual_closing (opname malam) - theoretical_closing
variance_pct = variance_qty / theoretical_closing * 100
is_flagged   = abs(variance_pct) > 5.0    # threshold dari config
```
**Catatan desain:** current_stock (ledger) dan actual_closing (opname) SENGAJA bisa beda —
bedanya itulah variance yang dilaporkan. `stock_adjustments` dipakai untuk menarik ledger balik
ke opname secara eksplisit (dengan reason wajib), TANPA mengubah formula variance.

### c. HPP per menu (services/hpp.py)
```
# per ingredient dalam BOM (skip packaging):
effective_cost = avg_cost_per_unit / cumulative_yield   # untuk processed
effective_cost = avg_cost_per_unit                       # untuk raw
cumulative_yield = PRODUCT(stage.yield_pct/100 for stage in production_stages)
# konversi unit recipe→base_unit bila beda (unit_conversions, reverse=1/factor, fallback 1.0)
hpp = SUM(recipe.qty_base × effective_cost)
food_cost_pct = hpp / selling_price * 100     # di-clamp ke 999.99 utk placeholder price=1
```
Disimpan ke `menu_hpp` (unique: menu_id + period_month).

### d. Weighted-average cost (services/avg_cost.py) — trigger tiap goods receipt confirm
```
new_avg = (old_avg × old_total_qty + new_price × new_qty) / (old_total_qty + new_qty)
```
**Initial stock** (opening balance resto yang sudah jalan) dicatat sebagai goods_receipts dengan
`is_initial_stock=true`, `price=0`, dan **TIDAK PERNAH** memanggil update_avg_cost.

### e. Sales entry — `entry_type`
- `sale` → masuk revenue + konsumsi bahan
- `complimentary` / `test` → TIDAK masuk revenue, TAPI tetap konsumsi bahan
- `consumption.py` mengambil SEMUA entry_type (tidak ada filter di konsumsi). Revenue hanya `WHERE entry_type='sale'`.

### f. Seasonal menu
Aktif jika `is_active=true` DAN (`is_seasonal=false` ATAU `valid_from<=today<=valid_until`).
Ditangani view `active_menus_today`.

---

## 6. Alur data end-to-end (bagaimana angka mengalir)

```
Belanja/Receipt ──► receipt_items ──► avg_cost update ──► HPP recalc
Opname pagi ──────► opening_qty
Sales Entry ──────► theoretical_consumption (sales × BOM)
Produksi ─────────► production_batches (raw→porsi, actual yield)
Waste ────────────► waste_logs
        ▼
theoretical_closing dihitung ─── vs ─── opname malam (actual_closing)
        ▼
variance_reports (auto-flag jika |pct|>5%) ──► Dashboard & Variance page
```

---

## 7. Status project saat ini (per 2026-07)

> **Sistem di-RESET 2026-06-30.** Saat ini hanya berisi **divisi Bar**. Data kitchen menunggu
> stock opname real dari admin.

| Tabel | Jumlah | Keterangan |
|---|---|---|
| `menu_items` | 54 | semua Bar, `selling_price=1` (placeholder, wajib diisi admin) |
| `ingredients` | ~92 aktif | 79 raw + 9 packaging + 1 processed (Gula Cair) — mayoritas `avg_cost=0` |
| `recipes` (BOM) | 219 | semua 54 menu punya BOM lengkap |
| `production_processes` | 1 | Gula Pasir → Gula Cair (yield 100%) |
| Semua tabel transaksi | 0 | variance/opname/sales/PO masih kosong |

**Belum ada / TODO setelah data kitchen masuk:**
- Isi `selling_price` 54 menu bar (sekarang placeholder=1)
- Isi harga bahan (avg_cost via goods receipt pertama)
- Seed ingredients + menu + BOM kitchen
- 11 production chains kitchen (Ayam Utuh→suir/dadu, Buntut Sapi, Bebek, Seafood, dll) — butuh yield% dari kitchen

---

## 8. Known issues & perbaikan terbaru (2026-07)

### Bug yang sudah diperbaiki (editing resep)
1. **`POST /menus/{id}/recipe/items` selalu 500** — `.maybe_single().execute()` di versi
   postgrest ini balikin `None` (bukan response) saat 0 baris; cek duplikat `if dup.data:` crash
   `AttributeError`. Happy-path (bahan baru = tak ada duplikat) selalu kena. **Fix:** helper `_md()`
   yang menormalkan None, dipasang di semua 13 titik `maybe_single` di `menus.py`.
2. **`DELETE /menus/{id}/recipe/{ing}` 500 untuk item yang punya riwayat** — audit log di-insert
   dengan `recipe_id` menunjuk baris recipe, lalu baris dihapus → langgar FK
   `recipe_change_log_recipe_id_fkey`. **Fix:** insert audit dengan `recipe_id=None` + null-kan
   referensi lama sebelum delete.
3. **Frontend `MenuDialog` menelan error** — BOM sync pakai `catch {}` sunyi, user lihat toast
   sukses padahal gagal. **Fix:** kumpulkan error → toast destructive.

### Latent issue (belum diperbaiki, low severity)
- Pola `maybe_single().execute()` + `.data` yang sama masih ada di router lain
  (`ingredients`, `production`, `vendors`, `units`, `hpp_analysis`, `avg_cost`) sebagai cek
  existence (`if not X.data:`). Hanya crash saat diberi ID tak valid (UI kirim ID valid dari
  dropdown), jadi jarang kena — tapi mengembalikan 500, bukan 404/422 yang bersih.

### Migration yang WAJIB dijalankan manual di Supabase SQL Editor
- `berlaris_migration_initial_stock.sql` — kolom `ingredients.package_size` + fitur initial stock
- `berlaris_migration_features.sql` — `recipe_change_log`, `waste_logs`, kolom `action`
- `berlaris_migration_stock_adjustments.sql` — tabel `stock_adjustments`
- `berlaris_migration_food_cost_pct_widen.sql` — lebarkan `food_cost_pct`/`variance_pct` ke NUMERIC(7,2) (placeholder price=1 bikin overflow)

### Catatan environment (bukan bug kode, tapi bikin bingung)
- **OneDrive + uvicorn `--reload`**: reload di tempat kadang menyajikan kode lama. Kalau perilaku
  aneh setelah edit backend → restart uvicorn penuh, jangan andalkan hot-reload.
- **CORS preflight cache di browser**: setelah restart backend, browser bisa cache OPTIONS 400.
  Perlu hard-reload.
- **Proses uvicorn ganda**: pernah ada 2-3 proses rebutan port 8000 menyajikan kode berbeda.
  Pastikan hanya 1 instance jalan.
- Login normal berfungsi tapi agak lambat (~4 dtk) karena roundtrip Supabase Auth (cold-start bisa >8 dtk).

---

## 9. Pertanyaan analisis yang berguna (buat mancing di claude.ai)

- Apakah formula `current_stock` (pure ledger) rentan drift jangka panjang tanpa periodic anchor? Kapan `stock_adjustments` sebaiknya dipakai?
- Konsistensi antara `theoretical_consumption` (dipakai ledger & variance) — apakah ada risiko double-counting antara ledger stock vs variance closing?
- HPP: efek `avg_cost=0` untuk mayoritas bahan terhadap validitas food-cost % sekarang. Urutan pengisian data yang benar?
- Desain 2-role (admin/owner) — cukup untuk kebutuhan audit, atau perlu jejak per-user lebih detail?
- Skalabilitas single-outlet → multi-outlet: tabel/formula mana yang paling perlu diubah?
- Integritas: banyak kalkulasi disimpan ke DB (denormalized). Strategi recalc/invalidation saat harga atau BOM berubah — apakah sudah lengkap? (lihat trigger HPP recalc di endpoint receipt & recipe)
- Robustness: pola `maybe_single().execute().data` sebagai sumber 500 — worth di-refactor jadi helper global?
