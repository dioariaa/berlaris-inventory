# Berlaris Inventory & Cost Intelligence System

## Satu kalimat
Sistem pengawasan berbasis web untuk owner dan tim audit Berlaris Kopi & Resto —
mendeteksi variance antara konsumsi teoritis (dari penjualan × BOM) vs stok fisik harian.

> **Daftar fitur lengkap** (nama, deskripsi, status, path module): lihat [FEATURES.md](FEATURES.md).

---

## Tech stack
- **Frontend**: React + Vite + TailwindCSS + shadcn/ui
- **Backend**: FastAPI (Python)
- **Database**: Supabase (PostgreSQL + Auth + Realtime)
- **Deployment**: Railway/Render (FastAPI), Vercel (React)
- **Excel processing**: pandas + openpyxl (bulk import BOM)

---

## Keputusan arsitektur yang sudah final

### Yang TIDAK ada di sistem ini
- Integrasi iSeller CSV/API → **dihapus**. Diganti Daily Sales Entry.
- RBAC kompleks → **hanya 2 role**: admin (full) dan owner (read-only dashboard).
- Multi-outlet → **belum**, arsitektur single-outlet.
- Real-time POS → **di v2.0**, bukan sekarang.

### Yang ADA di sistem ini
1. **Daily Sales Entry** — admin input qty terjual per menu per hari dari daftar menu.
   Ini menggantikan iSeller sync. Structure-nya POS-ready untuk v2.0.
2. **Daily Stock Opname** — admin input stok fisik setiap hari. Ground truth untuk variance.
3. **Production Batch Log** — kitchen log transformasi raw → porsi (penyusutan aktual per batch).
4. **Multi-stage yield** — penyusutan cascade: trim × masak × porsi = cumulative yield.
5. **HPP otomatis** — weighted average cost dari goods receipts × BOM → HPP per porsi.
6. **Variance harian** — opname fisik vs theoretical closing. Flag jika |variance_pct| > 5%.
7. **Seasonal menu** — valid_from/valid_until di menu_items. Event Idul Adha/Fitri ~4-5 menu.

---

## Business rules kritis — JANGAN salah implement

### Inventory dua level
- **Raw** = bahan yang dibeli dari vendor (ayam utuh, beras, minyak goreng, dll)
- **Processed** = porsi hasil produksi kitchen (Ayam Suir @20gr, Buntut Sapi @150gr, dll)
- **Packaging** = kemasan (hot cup, straw, dll) — **tidak masuk kalkulasi HPP**
- Recipe menu menggunakan **processed** ingredient, bukan raw langsung

### Formula variance harian (dihitung FastAPI, bukan di DB)
```
theoretical_closing =
    opening_qty (dari opname hari sebelumnya)
    + production_in_qty (dari production_batches hari ini)
    - theoretical_out_qty (dari daily_sales × BOM per ingredient)
    - waste_qty (dari waste_logs hari ini — semua reason)

variance_qty = actual_closing (opname malam) - theoretical_closing
variance_pct = variance_qty / theoretical_closing * 100

is_flagged = abs(variance_pct) > 5.0
```

**Normalisasi unit production_in (fix 2026-07-02)**: `production_in_qty` dihitung dari
`production_batches` hari itu dengan konversi yang sama seperti stock_level.py —
output ingredient: `+portions_actual × portion_size_g` (jika base unit g/ml; as-is untuk porsi/pcs);
raw ingredient: `-raw_qty_used` dikonversi dari `raw_unit_id` → base unit (negatif = raw terpakai produksi).
Self-check: `python -m tests.test_variance_production`.
`dashboard.py` sudah diaudit 2026-07-02: hanya membaca count/is_flagged batch dan
`get_current_stock()` (sudah ternormalisasi) — tidak ada bug unit di sana.

### Tabel baru (2026-06-30)
- **`waste_logs`**: pencatatan bahan terbuang. Fields: waste_date, ingredient_id, qty, unit_id, reason (expired/dropped/spoiled/wrong_prep/other), notes. Dikurangkan dari theoretical_closing di variance.
- **`recipe_change_log`**: audit trail perubahan BOM. TIDAK retroaktif — hanya berlaku untuk kalkulasi sejak perubahan. Kolom `action TEXT CHECK (action IN ('qty_change', 'ingredient_added', 'ingredient_removed'))`. `recipe_id` nullable (supaya hapus recipe row tidak break log). Untuk ingredient_added: old_qty=0, new_qty=qty_ditambah. Untuk ingredient_removed: old_qty=qty_terakhir, new_qty=0.
- **`daily_sales_entries`** (dimodifikasi): tambah `entry_type` TEXT ('sale'|'complimentary'|'test'), `notes`. Unique constraint diubah ke `(entry_date, menu_id, entry_type)`.

### Business rules sales entry — entry_type
- `entry_type = 'sale'`: masuk revenue, masuk konsumsi bahan
- `entry_type = 'complimentary'`: TIDAK masuk revenue, masuk konsumsi bahan (bahan tetap terpakai)
- `entry_type = 'test'`: TIDAK masuk revenue, masuk konsumsi bahan
- `consumption.py` mengambil SEMUA entry_type — tidak ada filter pada konsumsi bahan
- Revenue di dashboard hanya dari `WHERE entry_type = 'sale'`

### Formula current_stock (services/stock_level.py) — PURE LEDGER

**PENTING**: stok real-time TIDAK menggunakan opname sebagai anchor.
Opname hanya dipakai di `variance_reports` sebagai ground truth pembanding.
Kedua angka (current_stock vs actual_closing_opname) SENGAJA bisa berbeda —
perbedaannya adalah variance yang dilaporkan.

```
current_stock =
    SUM(receipt_items.received_qty WHERE ingredient_id = X)
  + SUM(production_batches.portions_actual WHERE output_ingredient_id = X)
  - SUM(production_batches.raw_qty_used WHERE process.raw_ingredient_id = X)
  - SUM(theoretical_consumption.consumed_qty WHERE ingredient_id = X)
  - SUM(waste_logs.qty WHERE ingredient_id = X)

# Akumulasi dari SEMUA transaksi sejak sistem pertama kali dipakai.
# TIDAK ada anchor_date, TIDAK ada dependency ke daily_stock_opname.

is_critical = current_stock <= min_threshold
is_low      = current_stock <= min_threshold * 1.5
```

**Peran opname**: hanya dipakai di `variance.py` untuk menghitung
`theoretical_closing` vs `actual_closing`. Tidak mempengaruhi tampilan
stok di StockLevels.jsx dan tidak masuk ke formula di atas.

**Normalisasi unit (fix 2026-07-02)**: semua komponen dihitung dalam base_unit ingredient.
`raw_qty_used` dikonversi dari `raw_unit_id` batch → base unit raw ingredient (via unit_conversions);
`portions_actual` (jumlah porsi) dikali `process.portion_size_g` jika base unit output = g/ml,
as-is jika base unit output = porsi/pcs. Tanpa ini, batch 2 kg cuma memotong 2 gram.
Self-check: `python -m tests.test_production_deduction`.

**Lokasi stok (storage vs division, 2026-07-02)**: 6 lokasi — setiap row `GET /stock/current`
punya `locations: {storage_bar, storage_kitchen, bar, kitchen, staff_meal, operational}`.
Lokasi DERIVED by rule (bukan kolom di tabel movement):
receipts → `po_category` item (kategori Belanja Harian = lokasi masuk; NULL/initial stock →
storage sesuai division: bar → storage_bar, else storage_kitchen);
production/consumption/waste/adjustment → division ingredient ('both' → kitchen).
Perpindahan eksplisit via tabel `stock_transfers` (`POST /transfers`, qty dalam base unit,
no approval workflow). UI transfer: halaman **Transfer Item** (sidebar Monitoring) — asal
transfer TERKUNCI ke storage divisi bahan, sekaligus berfungsi cek stok storage.
**Stok operasional = division_stock** (2026-07-03): setiap row `get_current_stock()` punya
`division_stock` (stok di division, siap pakai) dan `storage_stock` terpisah dari
`current_stock` (total). Flag is_critical/is_low, tampilan "Stok Kini" di StockLevels,
menu availability (`GET /menus/availability`), dan low-stock dashboard SEMUA berbasis
division_stock — storage TIDAK dihitung sebelum ditransfer ke division.
Migration: `berlaris_migration_stock_transfers.sql` LALU `berlaris_migration_storage_split.sql`
— keduanya WAJIB dijalankan di Supabase SQL Editor.
Self-check setelah migration: `python -m tests.test_transfers`.

**Guard stok negatif (2026-07-02)**: `services/stock_guard.py` —
`assert_sufficient_stock(_many)` dipanggil SEBELUM insert di sales entry
(delta konsumsi, di consumption.py), production batch (raw material),
waste log, dan transfer (from_location). Kalau kurang → `InsufficientStockError`
(HTTP 400) dengan pesan "X - Kitchen: stok tersedia A, butuh B, kurang C",
tidak ada row yang diinsert (sales entry di-restore dari snapshot).
PENGECUALIAN DISENGAJA: `stock_adjustments` (koreksi opname) TIDAK di-guard —
boleh menarik stok ke bawah nol untuk membetulkan ledger yang salah.
Tanpa row-lock (PostgREST) — kalau race multi-admin jadi masalah, pindah ke RPC FOR UPDATE.

### Formula HPP per menu (dihitung FastAPI, di-cache ke menu_hpp)
```
# Untuk setiap ingredient dalam BOM:
effective_cost = avg_cost_per_unit / cumulative_yield   # untuk processed ingredient

# Cumulative yield:
cumulative_yield = PRODUCT(stage.yield_pct / 100 for stage in production_stages)

# HPP per menu:
hpp = SUM(recipe.qty * effective_cost_ingredient for ingredient in BOM)

# Food cost %:
food_cost_pct = hpp / selling_price * 100
```

### Formula weighted average cost (dihitung FastAPI, di-simpan ke ingredients.avg_cost_per_unit)
```
new_avg = (old_avg * old_total_qty + new_price * new_qty) / (old_total_qty + new_qty)
```
Triggered setiap kali ada `goods_receipt` dikonfirmasi.

### Purchase unit conversion (2026-07-03)
Ingredient punya `purchase_unit` (VARCHAR, nullable) dan `conversion_factor` (DECIMAL, default 1).
Admin beli dalam purchase_unit (kg, galon, pack, dll), sistem konversi ke base_unit saat goods receipt.

```
ledger_qty = received_qty × conversion_factor
price_per_base_unit = actual_price_per_unit / conversion_factor
```

Contoh: Air Galon (base_unit=ml, purchase_unit=galon, conversion_factor=19000)
- Admin input: 2 galon @ Rp 30.000 → ledger: +38.000 ml, avg_cost = Rp 30.000/38.000 ≈ Rp 0.79/ml

Konversi terjadi di `goods_receipts.py` (quick-entry dan PO receipt) — `receipt_items.received_qty`
disimpan dalam base_unit supaya `stock_level.py` dan service lain tidak perlu diubah.
Migration: `berlaris_migration_purchase_unit.sql`.

### Seasonal menu logic
Menu aktif jika:
- `is_active = true` DAN
- `is_seasonal = false` ATAU (`valid_from <= today` DAN `valid_until >= today`)

View `active_menus_today` sudah handle ini.

---

## Database — 25 tabel (termasuk waste_logs, recipe_change_log, stock_transfers)

File DDL lengkap: `berlaris_schema.sql`  
Jalankan di Supabase SQL Editor sekali, semua tabel + seed data langsung terbuat.

### Cluster tabel

**Master data** (dikonfigurasi sekali di awal):
`users`, `units`, `unit_conversions`, `ingredients`, `menu_items`, `recipes`,
`vendors`, `ingredient_vendors`, `production_processes`, `production_stages`, `production_outputs`

**Operasional harian** (diisi admin setiap hari):
`daily_sales_entries`, `daily_stock_opname`, `production_batches`

**Kalkulasi (dihitung FastAPI, disimpan ke DB)**:
`theoretical_consumption`, `ingredient_cost_history`, `menu_hpp`, `variance_reports`

**PO & pembelian**:
`purchase_orders`, `po_items`, `goods_receipts`, `receipt_items`

**Audit**:
`audit_logs`

### Views yang sudah ada
- `active_menus_today` — menu aktif hari ini (termasuk seasonal)
- `flagged_variance_today` — ingredient yang variance >5% hari ini
- `food_cost_this_month` — HPP + food cost % semua menu bulan ini

---

## FastAPI endpoints

### Auth
- `POST /auth/login` — Supabase auth, return JWT ✅
- `POST /auth/refresh` ✅

### Master data (CRUD)
- `GET/POST/PUT/DELETE /ingredients` ✅
- `GET/POST/PUT/DELETE /menus` ✅ (termasuk reactivate menu nonaktif)
- `GET/POST/PUT/DELETE /menus/{id}/recipe` — BOM per menu ✅
- `POST /menus/bulk-import` — upload Excel template, pandas parse ✅
- `GET/POST/PUT/DELETE /vendors` ✅
- `GET/POST/PUT/DELETE /production-processes` ✅
- `GET/POST/PUT/DELETE /production-processes/{id}/stages` ✅
- `GET/POST/PUT/DELETE /units` ✅

### Operasional harian
- `GET /sales-entry/today` — tampilkan daftar menu aktif + qty hari ini ✅
- `POST /sales-entry` — submit qty per menu, trigger recalc theoretical_consumption ✅ (dengan stock guard)
- `GET /opname/today` — tampilkan ingredient + qty opname hari ini ✅
- `POST /opname` — submit physical count, trigger recalc variance ✅
- `POST /production-batches` — log batch produksi ✅ (dengan stock guard + unit conversion)
- `POST /waste` — log bahan terbuang ✅ (dengan stock guard)

### Stok & transfer
- `GET /stock/current` — stok real-time per ingredient (division_stock, storage_stock, locations) ✅
- `GET /stock/initial` — cek status initial stock ✅
- `POST /stock/initial` — input stok awal (sekali saja) ✅
- `GET /menus/availability` — ketersediaan menu berdasarkan division_stock ✅
- `POST /transfers` — transfer stok antar lokasi ✅ (dengan stock guard)
- `GET /transfers` — list transfer dengan filter ✅

### Belanja harian (goods receipts)
- `POST /goods-receipts/quick-entry` — input belanja harian per item ✅
- `GET /goods-receipts/items?date=` — list item belanja per tanggal ✅
- `PUT /goods-receipts/items/{item_id}` — edit item + avg_cost recompute ✅
- `DELETE /goods-receipts/items/{item_id}` — hapus item + avg_cost recompute ✅

### Kalkulasi (dipanggil internal atau saat trigger)
- `POST /calculate/theoretical-consumption?date=` — recalc dari sales entries ✅
- `POST /calculate/variance?date=` — recalc variance setelah opname ✅
- `POST /calculate/hpp?menu_id=` — recalc HPP + ingredient_breakdown ✅
- `POST /calculate/avg-cost/{ingredient_id}` — update weighted avg setelah receipt ✅

### PO & pembelian
- `GET/POST /purchase-orders` ✅
- `PUT /purchase-orders/{id}/status` ✅
- `POST /goods-receipts` — konfirmasi penerimaan, trigger avg-cost recalc ✅

### Dashboard & reports
- `GET /dashboard/summary` — KPIs: variance hari ini, food cost, spending bulan ini ✅
- `GET /dashboard/purchases?range=daily|weekly|monthly|custom` — rekap belanja per kategori ✅
- `GET /dashboard/food-cost-top` — food cost % per menu ✅
- `GET /dashboard/daily-sales` — ringkasan penjualan harian ✅
- `GET /hpp-analysis/...` — analisis HPP per menu ✅
- `GET /reports/generate` — export PDF/Excel audit report ✅

---

## Struktur folder project

```
berlaris/
├── backend/                    # FastAPI
│   ├── app/
│   │   ├── main.py             # App init, CORS, global 500 handler
│   │   ├── config.py           # Supabase URL, JWT secret, threshold=5.0
│   │   ├── dependencies.py     # get_current_user, require_admin, require_owner
│   │   ├── models/             # Pydantic schemas (request/response)
│   │   ├── routers/
│   │   │   ├── auth.py
│   │   │   ├── ingredients.py
│   │   │   ├── menus.py
│   │   │   ├── vendors.py
│   │   │   ├── units.py
│   │   │   ├── production.py
│   │   │   ├── sales_entry.py  # + stock guard + snapshot-restore rollback
│   │   │   ├── opname.py
│   │   │   ├── purchase_orders.py
│   │   │   ├── goods_receipts.py  # + quick-entry, edit/delete item
│   │   │   ├── dashboard.py    # summary, purchases (custom date), food-cost, daily-sales
│   │   │   ├── stock.py        # current stock, initial stock
│   │   │   ├── transfers.py    # stok transfer antar lokasi
│   │   │   ├── waste.py        # waste log + stock guard
│   │   │   ├── hpp_analysis.py
│   │   │   ├── calculate.py
│   │   │   └── reports.py
│   │   └── services/           # Business logic — semua formula ada di sini
│   │       ├── supabase.py     # Supabase client
│   │       ├── consumption.py  # Kalkulasi theoretical_consumption + stock guard
│   │       ├── variance.py     # Kalkulasi variance harian
│   │       ├── hpp.py          # Kalkulasi HPP + food cost % + ingredient_breakdown
│   │       ├── avg_cost.py     # Weighted average cost update + recompute from history
│   │       ├── yield_calc.py   # Cumulative yield dari production_stages
│   │       ├── stock_level.py  # Pure ledger stock (6 locations, division/storage split)
│   │       ├── stock_guard.py  # InsufficientStockError — cek sebelum insert
│   │       └── bulk_import.py  # pandas parser untuk Excel BOM
│   ├── tests/
│   │   ├── test_production_deduction.py
│   │   ├── test_transfers.py
│   │   ├── test_dashboard_purchases.py
│   │   ├── test_hpp_breakdown.py
│   │   ├── test_variance_production.py
│   │   ├── test_core_flow.py       # pytest E2E: sales→consumption→opname→variance→adjust + HPP
│   │   └── test_full_smoke.py      # pytest E2E 13 step: purchase→transfer→production→sales→waste→opname→adjust→variance→dashboard→isolasi lokasi
│   ├── requirements.txt
│   └── Dockerfile
│
├── frontend/                   # React + Vite
│   ├── src/
│   │   ├── main.jsx
│   │   ├── App.jsx
│   │   ├── lib/
│   │   │   ├── supabase.js     # Supabase client (Realtime)
│   │   │   └── api.js          # Axios wrapper ke FastAPI
│   │   ├── components/
│   │   │   ├── ui/             # shadcn/ui components
│   │   │   ├── layout/         # Sidebar, Header, PageWrapper
│   │   │   └── shared/         # DataTable, StatCard, Badge, etc.
│   │   └── pages/
│   │       ├── Login.jsx
│   │       ├── Dashboard.jsx          # KPIs, PurchaseRecap (custom date), food cost chart
│   │       ├── SalesEntry.jsx         # Admin: input menu terjual hari ini
│   │       ├── DailySales.jsx         # Ringkasan penjualan harian
│   │       ├── Opname.jsx             # Admin: input stok fisik harian
│   │       ├── ProductionBatch.jsx    # Admin: log batch produksi
│   │       ├── ProductionProcesses.jsx # CRUD production processes
│   │       ├── Ingredients.jsx        # CRUD ingredient master
│   │       ├── Menus.jsx              # CRUD menu + BOM builder + reactivate
│   │       ├── Vendors.jsx            # CRUD vendor
│   │       ├── Units.jsx              # CRUD units
│   │       ├── PurchaseOrders.jsx     # PO management
│   │       ├── DailyPurchaseEntry.jsx # Belanja harian + edit/delete koreksi
│   │       ├── StockLevels.jsx        # Stok real-time (division_stock + storage)
│   │       ├── InitialStock.jsx       # Input stok awal
│   │       ├── TransferItem.jsx       # Transfer storage → division
│   │       ├── Waste.jsx              # Log bahan terbuang
│   │       ├── HPPManagement.jsx      # HPP per menu + ingredient breakdown
│   │       ├── HPPAnalysis.jsx        # Analisis HPP
│   │       ├── Variance.jsx           # Laporan variance per periode
│   │       └── Reports.jsx            # Generate PDF/Excel
│   ├── package.json
│   └── vite.config.js
│
├── berlaris_schema.sql                    # DDL utama
├── berlaris_migration_initial_stock.sql   # package_size + initial_stock
├── berlaris_migration_stock_transfers.sql # stock_transfers table
├── berlaris_migration_storage_split.sql   # storage_bar/storage_kitchen split
├── berlaris_migration_purchase_unit.sql   # purchase_unit + conversion_factor
└── CLAUDE.md                              # File ini
```

---

## Roadmap development

### Phase 1 — Foundation ✅
- [x] Schema DDL (`berlaris_schema.sql`)
- [x] FastAPI project setup + Supabase connection
- [x] Auth: login, JWT middleware, require_admin/require_owner
- [x] CRUD: ingredients, units, unit_conversions
- [x] CRUD: menu_items (termasuk seasonal fields + reactivate nonaktif)
- [x] CRUD: recipes / BOM builder per menu
- [x] Bulk import: Excel template → pandas → insert recipes
- [x] CRUD: vendors, ingredient_vendors
- [x] CRUD: production_processes + stages + outputs
- [x] React: layout, login, semua halaman master data

### Phase 2 — Daily Operations ✅
- [x] `sales_entry` router: GET daftar menu aktif hari ini, POST submit (dengan stock guard)
- [x] `consumption.py` service: recalc theoretical_consumption dari sales
- [x] `opname` router: GET ingredient list, POST submit physical count
- [x] `yield_calc.py`: hitung cumulative yield dari production_stages
- [x] `avg_cost.py`: weighted average update saat goods receipt (+ recompute from history)
- [x] `hpp.py`: kalkulasi HPP per menu dengan trace-back ke raw ingredient (+ ingredient breakdown)
- [x] `production` router + batch logger (dengan stock guard + unit conversion)
- [x] React: SalesEntry, Opname, ProductionBatch pages
- [x] Belanja Harian: quick entry + edit/delete koreksi + avg_cost recompute cascade
- [x] Stok real-time: 6 lokasi (storage_bar, storage_kitchen, bar, kitchen, staff_meal, operational)
- [x] Stock guard: cek stok sebelum sales, production, waste, transfer (exception: adjustments)
- [x] Transfer Item: halaman khusus, from-location locked ke storage divisi
- [x] Waste log: pencatatan bahan terbuang dengan reason
- [x] Initial Stock: input stok awal resto yang sudah jalan

### Phase 3 — Variance + PO ✅
- [x] `variance.py` service: hitung variance harian setelah opname submit
- [x] Auto-flag: |variance_pct| > 5%
- [x] PO lifecycle: draft → sent → received
- [x] Goods receipt → trigger avg_cost recalc → trigger HPP recalc
- [x] React: PurchaseOrders, Variance pages

### Phase 4 — Dashboard + Reports ✅
- [x] Dashboard: Supabase Realtime subscription, KPI cards
- [x] Food cost chart per menu per bulan
- [x] Rekap belanja per kategori (daily/weekly/monthly/custom date range)
- [x] Variance report: filter per periode, per divisi, per bahan
- [x] Export PDF/Excel audit report
- [x] Seasonal menu management UI
- [x] HPP Management: per-menu HPP + ingredient cost breakdown
- [x] Daily Sales ringkasan

### Belum dikerjakan / menunggu data
- [ ] 11 production chains kitchen (menunggu yield % dari kitchen)
- [ ] Seed ingredients + menu + BOM kitchen (menunggu data dari admin, target 5 Juli 2026)
- [ ] Isi selling_price 54 menu bar (admin input manual)
- [ ] Isi avg_cost ingredient bar (dari goods receipt pertama / Belanja Harian)

---

## Data konteks penting

> **STATUS: Sistem direset 2026-06-30.**
> Hanya berisi **54 menu bar** dari `berlaris_bar_bom_clean.xlsx` + production process Gula Cair.
> Data kitchen **menunggu stock opname real dari admin tanggal 5 Juli 2026**.
> Semua data kitchen lama (ingredients, menu, BOM, production chains) sudah dihapus dan akan
> dibangun ulang setelah data real masuk.

### Kondisi DB setelah reset (2026-06-30)

| Tabel | Jumlah | Keterangan |
|---|---|---|
| `ingredients` | ~89 | 79 raw + 9 packaging + 1 processed (update 2026-07-01) |
| `menu_items` | 54 | Semua bar, `selling_price=1` (placeholder — wajib diisi admin) |
| `recipes` | 219 | BOM lengkap dari `berlaris_bar_bom_clean.xlsx` |
| `production_processes` | 1 | Gula Pasir → Gula Cair |
| `purchase_orders` | 0 | Kosong |
| `stock_transfers` | 0 | Tabel baru (migration 2026-07-02) |
| Semua tabel transaksi | 0 | Kosong (variance, opname, sales, dll) |

### 54 menu bar yang selling_price-nya perlu diisi admin

Semua di-seed dengan `selling_price=1` karena constraint DB `> 0`. Admin harus isi harga jual aktual via halaman Menus sebelum:
- HPP recalc bisa dijalankan (HPP% = HPP / selling_price)
- Sales Entry mulai dipakai (revenue calculation butuh harga)

Gunakan halaman **Menu & Resep** → klik ✏ Edit per menu → isi Harga Jual.

### Production process yang ada

Hanya **Gula Pasir → Gula Cair**:
- process_id: `32da6595-943c-4756-b8d1-e376233b8458`
- Stage: Melarutkan, yield_pct=100%
- Base cost: Gula Pasir Rp 18.000/kg → Gula Cair Rp 18.000/liter

### TODO setelah data kitchen masuk (5 Juli 2026)

1. **Stock opname bar** — catat stok fisik seluruh 63 ingredient bar
2. **Isi selling_price** untuk 54 menu bar
3. **Isi harga ingredient bar** — avg_cost masih 0 untuk semua. Input via goods receipt / purchase entry pertama
4. **Seed ingredients kitchen** — belum ada di DB. Butuh daftar dari kepala kitchen
5. **Seed menu kitchen + BOM** — belum ada
6. **11 production chains kitchen** — belum dikonfigurasi, butuh yield % dari kitchen:
   - Buntut/Iga Sapi → Buntut @150gr, Iga @150gr, Iga Suir
   - Daging Sapi → Daging Soto @40gr, Beef Patty @50gr, dll
   - Ayam Utuh → Ayam Suir @20gr, Ayam Dadu, Dada Slice, Paha Dungdung, dll
   - Daging Kambing → Daging Kambing @50gr
   - Bebek Hibrida → Bebek Olahan + Bumbu Bebek
   - Smoked Beef Utuh → Smoked Beef @20gr
   - Udang/Dori/Cumi → Mix Seafood @30gr
   - Ikan Dori → Fish & Chips @100gr
   - Kulit Springroll Kecil (TYJ) → Springroll @5pcs + Risol Soto
   - Kulit Springroll Besar (TYJ) → Samosa (**terpisah dari Kecil, jangan digabung**)
   - Singkong Mentah → Singkong @200gr, @100gr

---

## Catatan khusus untuk Claude Code

1. **Selalu gunakan Supabase client** dari `services/supabase.py` — jangan buat raw psycopg2 connection.
2. **Business logic di services/**, bukan di routers. Router hanya terima request, panggil service, return response.
3. **Variance dan HPP** harus dihitung di FastAPI, bukan di SQL trigger. Simpan hasilnya ke tabel.
4. **Bulk import Excel** pakai pandas. Format template: kolom Menu, Bahan, Qty, Satuan. Validasi sebelum insert.
5. **Audit log** setiap perubahan data di tabel utama (ingredients, menu_items, recipes, production_batches, variance_reports).
6. **Threshold 5%** disimpan di config.py sebagai `VARIANCE_THRESHOLD = 5.0` — jangan hardcode di service.
7. **Seasonal menu**: gunakan view `active_menus_today` saat GET /sales-entry/today.
8. **PO number** di-generate otomatis oleh DB function `generate_po_number()` — tidak perlu generate di Python.

---

## Bar — State setelah FULL RESET (2026-06-30)

> Bagian ini menggantikan dokumentasi lama "Bar — HPP Minuman". Semua instruksi standardisasi
> nama dan seed BOM sudah selesai dieksekusi. Tidak perlu diulangi.

### Apa yang sudah ada di DB

- **54 menu bar** dari `berlaris_bar_bom_clean.xlsx`, semua `selling_price=1` (placeholder — perlu diisi)
- **89 ingredient bar aktif** (79 raw + 9 packaging + 1 processed) — lihat "Update ingredient master (2026-07-01)" di bawah
- **219 BOM rows** — semua 54 menu punya BOM lengkap (0 menu tanpa BOM)
- **1 production process**: Gula Pasir → Gula Cair (yield=100%, 1 stage "Melarutkan")

### Ingredient yang BELUM ada avg_cost (perlu diisi dari goods receipt pertama)

Mayoritas bar ingredient avg_cost=0 (termasuk semua ingredient baru dari update 2026-07-01). Update via:
1. Input barang masuk di halaman **Belanja Harian** → otomatis update avg_cost
2. Atau via `POST /calculate/avg-cost/{ingredient_id}` setelah receipt dikonfirmasi
3. **Kecuali initial stock** — lihat bagian "Initial Stock" di bawah, initial stock TIDAK mengubah avg_cost

### Tamarind — 3 produk BERBEDA di DB (JANGAN digabung)
- `Sirup Tamarind` — sirup asam jawa konvensional (640g)
- `Syrup Asam Jawa 3 Teko` — merek "3 Teko", base_unit=ml
- `Syrup Asam Jawa GKC` — merek "GKC", base_unit=ml

(`Tamarind Concentrate` yang sebelumnya didokumentasikan di sini **tidak pernah ada di DB** — cek 2026-07-01 mengonfirmasi ini, tidak perlu dihapus.)

### Powder Coklat — 2 produk BERBEDA di DB (JANGAN digabung)
- `Powder Coklat Vilo` — daily use, package_size 946gr (sebelumnya bernama "Chocolate Powder", di-rename 2026-07-01 — ingredient_id TIDAK berubah, semua recipe existing tetap valid)
- `Powder Coklat Vanhouten` — premium, package_size 155gr, avg_cost=0 (belum diisi admin)

### Nutrijel vs Jelly Cincau — 2 ingredient BERBEDA (JANGAN digabung)
- `Nutrijel` — raw, bubuk mentah yang perlu dimasak jadi jelly (package_size 15gr)
- `Jelly Cincau` — raw, produk jadi dari cincau (sudah ada sebelumnya)

### Production process Gula Cair — spesifikasi final
- `ingredient_type = 'processed'`, `division = 'bar'`
- Chain: Gula Pasir (raw) → Gula Cair (processed)
- Yield=100%, base_unit Gula Cair = ml
- HPP: 1 kg Gula Pasir (Rp 18.000) → 1000 ml Gula Cair (Rp 18/ml)

### Update ingredient master (2026-07-01)

Dijalankan via scratchpad script (`langkah1_ingredients.py`). Total ingredient bar aktif sekarang: **89** (79 raw + 9 packaging + 1 processed), naik dari 65.

**4 ingredient yang diminta dihapus (Tamarind Concentrate, Kurma Buah, Susu Tujuh Kurma, Rempah Uwuh)**: dicek di DB, **tidak satupun ada** — kemungkinan tidak pernah diinsert atau sudah hilang saat FULL RESET 2026-06-30. Tidak ada action yang diperlukan.

**13 ingredient raw baru**: Arabica Halu Banana, Arabica Gayo, Arabica Bali Kintamani, Arabica Flores, Arabica Blueberry, Powder Coklat Vanhouten, Nutrijel, Santan Kara Cair, Lychee Kaleng, Daun Mint, Lump Sugar, Amidis Botol, Cream Charges, Es Batu, Kayu Manis.

**9 ingredient packaging baru**: Gula Pasir Sachet 6gr, Gula Aren Stick 6gr, Tropicana Slim, Plastik V60, Plastik Take Away Double, Hot Cup 8oz, Ice Cup 16oz, Sedotan Steril, Sedotan Bubble.

**Klarifikasi final ingredient bar (dari bartender, 2026-07-01)**:
- **Tropicana Slim** — dikonfirmasi 1 produk (bukan 2). "Gula Cana Slim" bukan produk terpisah.
- **Santan** — dikonfirmasi 1 produk dengan "Santan Kara Cair". Nama item = "Santan", merk = "Santan Kara". Ingredient duplikat "Santan Kara Cair" (baru diinsert) sudah **dihapus**; `package_size='200ml'` diisi ke "Santan" yang existing.
- **Air Mineral Galon** — dikonfirmasi produk sama dengan "Amidis Galon" (dari form cetak). `package_size='19L'`.
- **Syrup Asam Jawa 3 Teko** — `package_size='275ml'` dikonfirmasi admin.

### Field baru: `ingredients.package_size`

Kolom TEXT nullable — info kemasan beli untuk referensi admin (mis. `'1000gr'`, `'750ml'`, `'25bag'`), **bukan** `base_unit`. Membantu admin tahu "1 kemasan = berapa gram/ml" saat input stok awal atau belanja harian. NULL untuk bahan tanpa kemasan standar (buah segar, dll).

Migration: `berlaris_migration_initial_stock.sql` — **WAJIB dijalankan di Supabase SQL Editor** sebelum kolom ini ada / sebelum fitur Initial Stock bisa dipakai.

Data package_size untuk ~55 ingredient bar sudah ditranskrip dari form cetak dan siap diisi via `langkah3_package_size.py` (scratchpad) — **baru bisa dijalankan setelah migration di atas dieksekusi**.

### Initial Stock (opening balance)

Untuk resto yang sudah jalan saat sistem pertama kali dipakai — BUKAN belanja baru, BUKAN opname. Dicatat sebagai `goods_receipts` dengan `is_initial_stock=true`, `actual_price_per_unit=0` di semua `receipt_items`-nya.

**PENTING**: initial stock **TIDAK PERNAH** memanggil `update_avg_cost()` — tidak boleh mengubah `avg_cost_per_unit` ingredient sama sekali. Harga diisi terpisah lewat belanja nyata (Belanja Harian / goods receipt biasa).

Endpoint: `POST /stock/initial` (hanya bisa sekali — return 400 kalau sudah pernah), `GET /stock/initial` (cek status). Frontend: halaman `/initial-stock`, muncul di sidebar grup Monitoring HANYA kalau belum pernah diisi. Banner peringatan otomatis muncul di Stock Levels kalau `has_initial_stock=false`.