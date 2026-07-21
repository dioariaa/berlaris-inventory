# FEATURES.md — Daftar Fitur Berlaris Inventory & Cost Intelligence System

> Auto-generated dari scan codebase (2026-07-03). Status: `done` = sudah diimplementasi dan berjalan,
> `in-progress` = sebagian jadi / menunggu data, `planned` = belum dikerjakan.
>
> Detail business rules dan formula ada di [CLAUDE.md](CLAUDE.md).

---

## Auth & Akses

- [x] **Login & JWT Auth** — Login via Supabase Auth, return JWT + refresh token. `done`
  - Router: `backend/app/routers/auth.py` | UI: `frontend/src/pages/Login.jsx`
- [x] **Role-based access (2 role)** — admin (full access) dan owner (read-only dashboard). `done`
  - Module: `backend/app/dependencies.py` (`require_admin`, `require_owner`)

## Master Data

- [x] **CRUD Ingredients** — Kelola bahan (raw/processed/packaging), package_size, purchase_unit + conversion_factor. `done`
  - Router: `backend/app/routers/ingredients.py` | UI: `frontend/src/pages/Ingredients.jsx`
- [x] **CRUD Menu + BOM builder** — Kelola menu (termasuk seasonal valid_from/valid_until), recipe per menu, reactivate menu nonaktif. `done`
  - Router: `backend/app/routers/menus.py` | UI: `frontend/src/pages/Menus.jsx`
- [x] **Bulk import BOM dari Excel** — Upload template Excel (Menu, Bahan, Qty, Satuan) → pandas parse → insert recipes. `done`
  - Service: `backend/app/services/bulk_import.py` (endpoint `POST /menus/bulk-import`)
- [x] **CRUD Vendors** — Kelola vendor + ingredient_vendors. `done`
  - Router: `backend/app/routers/vendors.py` | UI: `frontend/src/pages/Vendors.jsx`
- [x] **CRUD Units + konversi unit** — Kelola satuan dan unit_conversions. `done`
  - Router: `backend/app/routers/units.py` | UI: `frontend/src/pages/Units.jsx`
- [x] **CRUD Production Processes + Stages** — Definisi proses raw → processed dengan yield % per stage (multi-stage cascade). `done`
  - Router: `backend/app/routers/production.py` | UI: `frontend/src/pages/ProductionProcesses.jsx`

## Operasional Harian

- [x] **Daily Sales Entry** — Admin input qty terjual per menu per hari (entry_type: sale/complimentary/test), dengan stock guard + snapshot-restore rollback. `done`
  - Router: `backend/app/routers/sales_entry.py` | UI: `frontend/src/pages/SalesEntry.jsx`
- [x] **Daily Stock Opname** — Input stok fisik harian, ground truth untuk variance. `done`
  - Router: `backend/app/routers/opname.py` | UI: `frontend/src/pages/Opname.jsx`
- [x] **Production Batch Log** — Kitchen log transformasi raw → porsi, dengan stock guard + konversi unit (raw_unit → base_unit). `done`
  - Router: `backend/app/routers/production.py` | UI: `frontend/src/pages/ProductionBatch.jsx`
- [x] **Waste Log** — Pencatatan bahan terbuang (expired/dropped/spoiled/wrong_prep/other), dikurangkan dari theoretical_closing. `done`
  - Router: `backend/app/routers/waste.py` | UI: `frontend/src/pages/Waste.jsx`
- [x] **Belanja Harian (quick entry)** — Input belanja per item + edit/delete koreksi dengan avg_cost recompute cascade + konversi purchase_unit. `done`
  - Router: `backend/app/routers/goods_receipts.py` | UI: `frontend/src/pages/DailyPurchaseEntry.jsx`

## Stok & Transfer

- [x] **Stok real-time (pure ledger)** — current_stock akumulasi dari semua transaksi, tanpa anchor opname; split division_stock vs storage_stock, flag is_critical/is_low berbasis division_stock. `done`
  - Service: `backend/app/services/stock_level.py` | Router: `backend/app/routers/stock.py` | UI: `frontend/src/pages/StockLevels.jsx`
- [x] **6 lokasi stok (derived by rule)** — storage_bar, storage_kitchen, bar, kitchen, staff_meal, operational. `done`
  - Service: `backend/app/services/stock_level.py`
- [x] **Transfer Item antar lokasi** — Transfer storage → division, asal terkunci ke storage divisi bahan, dengan stock guard. `done`
  - Router: `backend/app/routers/transfers.py` | UI: `frontend/src/pages/TransferItem.jsx`
- [x] **Stock guard (cegah stok negatif)** — Cek stok sebelum sales, production, waste, transfer → HTTP 400 kalau kurang. Pengecualian disengaja: stock_adjustments. `done`
  - Service: `backend/app/services/stock_guard.py`
- [x] **Initial Stock (opening balance)** — Input stok awal sekali saja, dicatat sebagai goods_receipt is_initial_stock=true, TIDAK mengubah avg_cost. `done`
  - Router: `backend/app/routers/stock.py` | UI: `frontend/src/pages/InitialStock.jsx`
- [x] **Menu availability** — Ketersediaan menu berdasarkan division_stock (`GET /menus/availability`). `done`
  - Router: `backend/app/routers/menus.py`

## Kalkulasi & Intelligence

- [x] **Theoretical consumption** — Konsumsi teoritis bahan dari daily_sales × BOM (semua entry_type). `done`
  - Service: `backend/app/services/consumption.py` | Router: `backend/app/routers/calculate.py`
- [x] **Variance harian** — theoretical_closing vs actual_closing opname, auto-flag |variance_pct| > 5%, dengan normalisasi unit production_in. `done`
  - Service: `backend/app/services/variance.py` | UI: `frontend/src/pages/Variance.jsx`
- [x] **HPP otomatis per menu** — HPP dari BOM × effective_cost (avg_cost / cumulative_yield) + food cost % + ingredient breakdown, di-cache ke menu_hpp. `done`
  - Service: `backend/app/services/hpp.py` | UI: `frontend/src/pages/HPPManagement.jsx`, `frontend/src/pages/HPPAnalysis.jsx`
- [x] **Weighted average cost** — Update avg_cost_per_unit setiap goods receipt dikonfirmasi + recompute from history. `done`
  - Service: `backend/app/services/avg_cost.py`
- [x] **Cumulative yield multi-stage** — Penyusutan cascade: trim × masak × porsi. `done`
  - Service: `backend/app/services/yield_calc.py`

## PO & Pembelian

- [x] **Purchase Order lifecycle** — draft → sent → received, PO number auto-generate dari DB function. `done`
  - Router: `backend/app/routers/purchase_orders.py` | UI: `frontend/src/pages/PurchaseOrders.jsx`
- [x] **Goods Receipt** — Konfirmasi penerimaan PO → trigger avg_cost recalc → trigger HPP recalc. `done`
  - Router: `backend/app/routers/goods_receipts.py`

## Dashboard & Laporan

- [x] **Dashboard KPI** — Variance hari ini, food cost, spending bulan ini, low-stock alert, Supabase Realtime. `done`
  - Router: `backend/app/routers/dashboard.py` | UI: `frontend/src/pages/Dashboard.jsx`
- [x] **Rekap belanja per kategori** — Range daily/weekly/monthly/custom date. `done`
  - Router: `backend/app/routers/dashboard.py` (`GET /dashboard/purchases`)
- [x] **Ringkasan penjualan harian** — Rekap penjualan per hari. `done`
  - Router: `backend/app/routers/dashboard.py` | UI: `frontend/src/pages/DailySales.jsx`
- [x] **Laporan variance per periode** — Filter per periode, per divisi, per bahan. `done`
  - UI: `frontend/src/pages/Variance.jsx`
- [x] **Export PDF/Excel audit report** — Generate laporan audit. `done`
  - Router: `backend/app/routers/reports.py` | UI: `frontend/src/pages/Reports.jsx`

## Testing

- [x] **Self-check & E2E tests** — test_core_flow (sales→consumption→opname→variance→adjust + HPP), test_full_smoke (13 step E2E), plus test unit untuk production deduction, transfers, variance production, dashboard purchases, HPP breakdown. `done`
  - Path: `backend/tests/`

## Menunggu Data / Belum Dikerjakan

- [ ] **11 production chains kitchen** — Menunggu yield % dari kitchen (Buntut/Iga, Ayam Utuh, dll — lihat CLAUDE.md). `planned`
- [ ] **Seed ingredients + menu + BOM kitchen** — Menunggu stock opname real dari admin, target 5 Juli 2026. `planned`
- [ ] **Isi selling_price 54 menu bar** — Semua masih placeholder `selling_price=1`, admin input manual via halaman Menus. `in-progress`
- [ ] **Isi avg_cost ingredient bar** — Mayoritas masih 0, terisi dari goods receipt pertama / Belanja Harian. `in-progress`
- [ ] **Integrasi POS real-time** — Direncanakan v2.0 (struktur Daily Sales Entry sudah POS-ready). `planned`
- [ ] **Multi-outlet** — Belum, arsitektur saat ini single-outlet. `planned`
