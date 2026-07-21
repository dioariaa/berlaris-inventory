# Berlaris Project Progress

_Last updated: 2026-07-03_

---

## Status Keseluruhan

**Semua 4 phase development SELESAI.** Sistem siap dipakai operasional begitu data diisi (selling_price, avg_cost, initial stock, data kitchen).

---

## Phase 1 — Foundation ✅ SELESAI

| Komponen | Status | File utama |
|---|---|---|
| Schema DDL | ✅ | `berlaris_schema.sql` (23 tabel + views + seed) |
| FastAPI setup + CORS + global error handler | ✅ | `backend/app/main.py` |
| Config + Supabase client | ✅ | `config.py`, `services/supabase.py` |
| Auth (login, JWT, role guard) | ✅ | `routers/auth.py`, `dependencies.py` |
| CRUD ingredients | ✅ | `routers/ingredients.py` |
| CRUD units + conversions | ✅ | `routers/units.py` |
| CRUD menus (seasonal + reactivate nonaktif) | ✅ | `routers/menus.py` |
| CRUD recipes / BOM + bulk import Excel | ✅ | `routers/menus.py`, `services/bulk_import.py` |
| CRUD vendors + ingredient_vendors | ✅ | `routers/vendors.py` |
| CRUD production processes + stages + outputs | ✅ | `routers/production.py` |
| Frontend: Login, Ingredients, Menus, Vendors, Units, ProductionProcesses | ✅ | `frontend/src/pages/` |

---

## Phase 2 — Daily Operations ✅ SELESAI

| Komponen | Status | File utama |
|---|---|---|
| Sales Entry (+ stock guard + rollback) | ✅ | `routers/sales_entry.py`, `services/consumption.py` |
| Opname (+ stock adjustments tanpa guard) | ✅ | `routers/opname.py` |
| Production Batch (+ stock guard + unit conversion) | ✅ | `routers/production.py` |
| Waste Log (+ stock guard, 5 reason types) | ✅ | `routers/waste.py` |
| Cumulative yield (multi-stage cascade) | ✅ | `services/yield_calc.py` |
| Weighted avg cost (+ recompute from history) | ✅ | `services/avg_cost.py` |
| HPP calculation (+ ingredient breakdown) | ✅ | `services/hpp.py` |
| Theoretical consumption (semua entry_type) | ✅ | `services/consumption.py` |
| Stok real-time (pure ledger, 6 lokasi) | ✅ | `services/stock_level.py` |
| Stock guard (4 call sites, exception: adjustments) | ✅ | `services/stock_guard.py` |
| Transfer stok (storage → division, with guard) | ✅ | `routers/transfers.py` |
| Initial stock (sekali saja, tidak ubah avg_cost) | ✅ | `routers/stock.py` |
| Belanja Harian (quick entry + edit/delete + recompute) | ✅ | `routers/goods_receipts.py` |
| Frontend: SalesEntry, Opname, ProductionBatch, Waste, StockLevels, InitialStock, TransferItem, DailyPurchaseEntry | ✅ | `frontend/src/pages/` |

---

## Phase 3 — Variance + PO ✅ SELESAI

| Komponen | Status | File utama |
|---|---|---|
| Variance calculation (auto-flag >5%, unit normalization) | ✅ | `services/variance.py` |
| PO lifecycle (draft → sent → partial → received/cancelled) | ✅ | `routers/purchase_orders.py` |
| Goods receipt → avg_cost → HPP cascade | ✅ | `routers/goods_receipts.py` |
| Frontend: PurchaseOrders, Variance | ✅ | `frontend/src/pages/` |

---

## Phase 4 — Dashboard + Reports ✅ SELESAI

| Komponen | Status | File utama |
|---|---|---|
| Dashboard KPI cards + Realtime | ✅ | `routers/dashboard.py`, `Dashboard.jsx` |
| Rekap belanja (daily/weekly/monthly/custom date range) | ✅ | `GET /dashboard/purchases` |
| Food cost chart + top list | ✅ | `GET /dashboard/food-cost-top` |
| Daily sales ringkasan | ✅ | `GET /dashboard/daily-sales` |
| Variance report (filter per periode/divisi/bahan) | ✅ | `Variance.jsx` |
| Export PDF/Excel audit report | ✅ | `routers/reports.py` |
| HPP Management (per-menu HPP + ingredient breakdown) | ✅ | `HPPManagement.jsx` |
| HPP Analysis | ✅ | `routers/hpp_analysis.py`, `HPPAnalysis.jsx` |
| Seasonal menu management UI | ✅ | `Menus.jsx` |

---

## Database Migrations (semua sudah dijalankan kecuali yang ditandai)

| Migration | Tanggal | Isi |
|---|---|---|
| `berlaris_schema.sql` | 2026-06-30 | 23 tabel utama + views + seed |
| `berlaris_migration_initial_stock.sql` | 2026-07-01 | package_size column + initial stock fields |
| `berlaris_migration_stock_transfers.sql` | 2026-07-02 | stock_transfers table |
| `berlaris_migration_storage_split.sql` | 2026-07-02 | storage_bar/storage_kitchen split |
| `berlaris_migration_purchase_unit.sql` | 2026-07-03 | purchase_unit + conversion_factor di ingredients (**BELUM dijalankan**) |

---

## Tests

| Test | Status | Cakupan |
|---|---|---|
| `test_production_deduction` | ✅ | Unit conversion raw_qty_used di ledger |
| `test_transfers` | ✅ | 7 skenario: transfer + 4 rejects + adjustment exception |
| `test_dashboard_purchases` | ✅ | Purchase recap endpoint |
| `test_hpp_breakdown` | ✅ | HPP ingredient breakdown values |
| `test_variance_production` | ✅ | Variance + production unit normalization |
| `test_full_smoke` | ✅ | Full smoke test 13 step: purchase → transfer → production → sales → waste → opname → adjustment → variance → dashboard → isolasi lokasi, termasuk 4 guard reject (400 + rollback bersih). Jalankan sebelum go-live: `pytest tests/test_full_smoke.py -v -s` |

---

## Perbaikan Teknis Penting (2026-07-02 — 2026-07-03)

10. **Purchase unit conversion**: ingredient punya `purchase_unit` + `conversion_factor` — admin input qty beli dalam satuan beli (kg, galon, pack), backend otomatis konversi ke base_unit saat goods receipt. `receipt_items.received_qty` disimpan dalam base_unit supaya stock_level.py dan service lain tidak perlu diubah. UI: field Satuan Beli + Konversi di dialog ingredient, preview konversi di Belanja Harian.

### Detail perbaikan sebelumnya

1. **Unit conversion fix**: `raw_qty_used` di production batch dikonversi dari `raw_unit_id` → base unit (sebelumnya batch 2 kg hanya memotong 2 gram)
2. **Storage/division split**: 6 lokasi fisik (`storage_bar`, `storage_kitchen`, `bar`, `kitchen`, `staff_meal`, `operational`). Stok operasional (`division_stock`) terpisah dari storage — semua UI, menu availability, dan HPP hanya melihat `division_stock`
3. **Stock guard**: mencegah stok negatif di 4 titik (sales, production, waste, transfer). Exception disengaja untuk stock adjustments (koreksi opname)
4. **Sales entry rollback**: snapshot-restore karena PostgREST tidak punya transaksi
5. **avg_cost recompute**: edit/delete purchase item → rekalkulasi penuh dari `ingredient_cost_history` → cascade ke HPP
6. **CORS 500 fix**: global exception handler di `main.py` dengan manual CORS headers (500 default FastAPI tidak melewati CORSMiddleware)
7. **Belanja Harian polish**: dropdown autocomplete tidak lagi ketimpa (overflow-hidden removed), edit/delete item yang sudah dicatat
8. **Reactivate menu**: menu nonaktif bisa diaktifkan kembali via UI
9. **Dashboard purchase recap**: custom date range (`from`/`to`) selain daily/weekly/monthly

---

## Kondisi DB Saat Ini (post-reset 2026-06-30, update 2026-07-03)

| Tabel | Jumlah | Keterangan |
|---|---|---|
| `ingredients` | ~89 | 79 raw + 9 packaging + 1 processed (update 2026-07-01) |
| `menu_items` | 54 | Semua bar, `selling_price=1` (placeholder) |
| `recipes` | 219 | BOM lengkap 54 menu bar |
| `production_processes` | 1 | Gula Pasir → Gula Cair |
| `stock_transfers` | 0 | Tabel baru (migration 2026-07-02) |
| Semua tabel transaksi | 0 | Kosong |

---

## Menunggu Data / Action Admin

| Item | Detail | Target |
|---|---|---|
| Isi `selling_price` 54 menu bar | Admin input via Menu & Resep → Edit | Sebelum HPP% dan revenue bisa dihitung |
| Isi `avg_cost` ingredient bar | Dari goods receipt pertama / Belanja Harian | Sebelum HPP bisa dihitung |
| Input stok awal (initial stock) | Admin via halaman `/initial-stock` | Sebelum stok real-time akurat |
| Stock opname bar | Catat stok fisik 63+ ingredient | Untuk variance pertama |
| Seed ingredients kitchen | Daftar dari kepala kitchen | Target 5 Juli 2026 |
| Seed menu kitchen + BOM | Data dari kitchen | Setelah ingredients kitchen masuk |
| 11 production chains kitchen | Yield % dari kitchen (lihat detail di CLAUDE.md) | Setelah data kitchen masuk |
| 14 vendor tanpa ingredient link | Data entry di `ingredient_vendors` | Nice-to-have, bisa post-launch |

---

## Historical Notes

### FULL RESET (2026-06-30)
- Semua data kitchen lama dihapus. Hanya bar data dipertahankan.
- 11 _TEST menus dihapus (hard delete).
- 54 menu bar di-seed dari `berlaris_bar_bom_clean.xlsx` dengan `selling_price=1`.
- 219 BOM rows, 89 ingredients (update 2026-07-01), 1 production process.

### Bar BOM Import (2026-06-30)
- Sumber: `HPP RECIPE BERLARIS BEVERAGE (2).xlsx` (65 sheets)
- 276 recipe rows inserted, packaging di-skip
- HPP bar avg food cost: 23.4%

### Ingredient Master Update (2026-07-01)
- +13 raw baru, +9 packaging baru (via scratchpad `langkah1_ingredients.py`)
- Klarifikasi: Tropicana Slim (1 produk), Santan (= Santan Kara), Air Mineral Galon (= Amidis Galon)
- package_size data ~55 ingredient bar ditranskrip dari form cetak
