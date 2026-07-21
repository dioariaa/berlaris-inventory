# Berlaris — Security Review & Progress Report

**Tanggal:** 2026-07-21
**Scope:** Defensive security review (config audit, bukan pentest) + progress report keseluruhan
**Reviewer:** Claude Code

> **Catatan verifikasi:** State DB live (`xvzujceymyozqztdongm`) **tidak bisa dibaca** dari sesi review ini — MCP Supabase tersambung ke project berbeda (`opnkfxycxfayggcomohm`/CutiProject), dan project Berlaris menolak akses ("permission denied"). Temuan RLS/SQL di bawah berdasarkan file `berlaris_schema.sql` + migration apa adanya. Query verifikasi disediakan di bagian a untuk dijalankan sendiri di Supabase SQL Editor.

---

## TUGAS 1 — Security Review

### Ringkasan temuan

| # | Severity | Area | Lokasi |
|---|----------|------|--------|
| a | 🔴 **High** | RLS tidak ditegakkan | `berlaris_schema.sql:795-823` + semua tabel migration |
| b1 | 🟢 OK | Secret di client build | `frontend/dist/` — bersih, hanya anon key |
| b2 | 🟠 Med | Secret plaintext di OneDrive tanpa `.gitignore` | `backend/.env` |
| b3 | 🟡 Low | `ENVIRONMENT=development` | `backend/.env:6`, `main.py:14-18` |
| c | 🟡 Low-Med | Tidak ada batas atas / sanity check input | `backend/app/models/*` |
| d | 🟠 Med | Stock guard app-layer, race-prone, bisa dilewati | `services/stock_guard.py` |
| e1 | 🟠 Med | `login` abaikan `is_active` | `routers/auth.py:59-75` |
| e2 | 🟡 Low | `GET /units` tanpa auth | `routers/units.py:16-33` |

---

### a. Supabase RLS — 🔴 High

**Risiko.** Dua masalah bertumpuk:

1. **10 tabel di-enable RLS tapi policy-nya dikomentari.** Baris 784-793 menjalankan `ENABLE ROW LEVEL SECURITY` pada `users, ingredients, menu_items, recipes, daily_sales_entries, daily_stock_opname, production_batches, variance_reports, purchase_orders, audit_logs` — tapi seluruh `CREATE POLICY` ada di dalam blok `/* ... */` (baris 799-823), **tidak pernah dieksekusi**. RLS aktif tanpa policy = default-deny untuk anon & authenticated (hanya service_role lolos).

2. **Belasan tabel tidak pernah di-enable RLS:** `units, unit_conversions, vendors, ingredient_vendors, production_processes, production_stages, production_outputs, po_items, theoretical_consumption, goods_receipts, receipt_items, ingredient_cost_history, menu_hpp` + semua tabel migration (`waste_logs, recipe_change_log, stock_transfers, stock_adjustments`).

**Kenapa berbahaya.** Anon key bersifat **publik** — ter-bundle di `frontend/dist/assets/index-Bj48l259.js` (memang seharusnya). Untuk tabel dengan RLS OFF, siapa pun yang buka DevTools bisa memanggil PostgREST langsung dengan anon key dan:

- **Membaca semua data biaya:** `receipt_items.actual_price_per_unit` (semua harga beli), `ingredient_cost_history`, `menu_hpp` (HPP & food cost tiap menu), `theoretical_consumption`.
- **Menulis langsung ke ledger:** INSERT/UPDATE/DELETE ke `receipt_items`, `stock_transfers`, `stock_adjustments`, `goods_receipts` — **melewati FastAPI dan `assert_sufficient_stock` sepenuhnya**. Guard stok hanya jalan di layer Python, tidak menahan direct write. Satu INSERT liar ke `receipt_items` = stok hantu + `avg_cost` rusak saat recompute berikutnya.

**Efek samping fungsional.** Frontend Realtime subscribe (`Dashboard.jsx`, `StockLevels.jsx`) memakai anon client yang **tidak login ke Supabase Auth** (login lewat FastAPI yang menerbitkan JWT sendiri). Koneksi Realtime berjalan sebagai role `anon`. Untuk tabel RLS-on-tanpa-policy (`variance_reports`, `daily_stock_opname`, `production_batches`), event `postgres_changes` **ditolak diam-diam** — Realtime dashboard kemungkinan tidak berfungsi. Kalau ternyata jalan, artinya RLS belum benar-benar aktif.

**Fix.** Enable RLS di seluruh tabel `public`, deny-by-default, tanpa policy write untuk anon (backend tetap jalan lewat service_role yang bypass RLS):

```sql
-- Enable RLS di SEMUA tabel yang belum
ALTER TABLE units                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE unit_conversions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendors                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE ingredient_vendors      ENABLE ROW LEVEL SECURITY;
ALTER TABLE production_processes    ENABLE ROW LEVEL SECURITY;
ALTER TABLE production_stages       ENABLE ROW LEVEL SECURITY;
ALTER TABLE production_outputs      ENABLE ROW LEVEL SECURITY;
ALTER TABLE po_items                ENABLE ROW LEVEL SECURITY;
ALTER TABLE theoretical_consumption ENABLE ROW LEVEL SECURITY;
ALTER TABLE goods_receipts          ENABLE ROW LEVEL SECURITY;
ALTER TABLE receipt_items           ENABLE ROW LEVEL SECURITY;
ALTER TABLE ingredient_cost_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE menu_hpp                ENABLE ROW LEVEL SECURITY;
ALTER TABLE waste_logs              ENABLE ROW LEVEL SECURITY;
ALTER TABLE recipe_change_log       ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_transfers         ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_adjustments       ENABLE ROW LEVEL SECURITY;
-- (10 tabel di schema sudah ENABLE; biarkan)

-- TIDAK usah tambah policy apa pun untuk anon/authenticated.
-- service_role (FastAPI) otomatis bypass RLS → backend tetap berfungsi penuh.
```

Karena semua akses sah ada di belakang FastAPI (service_role), deny-total ke anon adalah postur yang benar. Konsekuensinya Realtime anon mati — pilih salah satu (keputusan owner):

- **(A) Polling** — ganti Realtime jadi `GET /stock/current` tiap N detik. Paling simpel & aman untuk ~20 staff.
- **(B) Supabase session asli** — frontend login ke Supabase Auth, lalu policy `FOR SELECT TO authenticated USING (true)` pada ~5 tabel yang di-subscribe:

```sql
CREATE POLICY realtime_read ON variance_reports
  FOR SELECT TO authenticated USING (true);
```

**Verifikasi kondisi live** (jalankan di SQL Editor project Berlaris):

```sql
SELECT relname AS tabel,
       relrowsecurity  AS rls_enabled,
       (SELECT count(*) FROM pg_policies p WHERE p.tablename = c.relname) AS jml_policy
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r'
ORDER BY rls_enabled, tabel;
```

- `rls_enabled = false` → terekspos anon key.
- `rls_enabled = true, jml_policy = 0` → terkunci (aman untuk arsitektur ini, tapi Realtime anon mati).

Jalankan juga `get_advisors(type: security)` di project Berlaris untuk menangkap missing-RLS otomatis.

---

### b. Secret leakage

**b1 — Client build: bersih (🟢 OK).** Grep `frontend/dist`: hanya anon key ter-bundle (semestinya begitu). **Service role key & JWT_SECRET tidak bocor ke bundle** — Vite hanya expose var berprefiks `VITE_`.

**b2 — Secret plaintext di OneDrive (🟠 Med).** `backend/.env` berisi `SUPABASE_SERVICE_ROLE_KEY` (god-mode DB, bypass RLS) & `JWT_SECRET` (kunci simetris token app) dalam plaintext, di folder **OneDrive tersinkron cloud**, dan **tidak ada `.gitignore`** (belum git repo). Bocornya JWT_SECRET = siapa pun bisa memalsukan token `{"role":"admin"}`.

**Fix:**
- Buat `.gitignore` berisi `.env`, `*.env`, `frontend/dist/` **sebelum** `git init`.
- Pindahkan secret ke env var platform deploy (Railway/Render/Vercel secrets), jangan sinkron via OneDrive.
- **Rotasi** service_role key + JWT_SECRET jika folder pernah dibagikan.

**b3 — `ENVIRONMENT=development` (🟡 Low).** Membuat `/docs` terbuka & CORS terima `http://localhost:*`. Pastikan server produksi set `ENVIRONMENT=production` (Swagger tertutup, CORS hanya `https://berlaris.vercel.app`).

---

### c. Input validation — 🟡 Low-Med

**Sudah baik:** validasi tipe + non-negatif konsisten — `waste.qty > 0`, `transfer.qty > 0`, `opname.physical_qty ≥ 0`, `sales.qty_sold ≥ 0`, `receipt received_qty/price` non-negatif, `production.raw_qty_used > 0`. ID (menu/ingredient/unit/vendor) divalidasi terhadap DB di jalur tulis (`sales_entry.py:137`, `goods_receipts.py:263`).

**Celah:**
- **Tidak ada batas atas** — salah ketik `999999999` kg lolos & meracuni ledger + avg_cost. Tambah `le=` wajar, mis. `Field(gt=0, le=1_000_000)`.
- **`production.portions_actual: int` tanpa validator** (`models/production.py:143`) — nilai negatif menambah stok output aneh. Tambah `ge=0`.
- **Tanggal tanpa sanity check** — bisa masa depan jauh / 1900. Pertimbangkan tolak > hari ini.
- **Poin utama:** semua validasi ini **hanya jalan di FastAPI**. Kalau RLS off (temuan a), direct write ke DB melewati seluruhnya. Validasi hanya sekuat RLS.

---

### d. RPC / Postgres functions — 🟠 Med

`assert_sufficient_stock`/`_many` adalah **fungsi Python, bukan RPC Postgres** — tidak ada `SECURITY DEFINER`/`INVOKER` untuk ditinjau. Implikasi:

- **Bisa dilewati** direct write ke DB (temuan a) — guard menempel di endpoint, bukan di data.
- **Check-then-write tanpa row lock** (didokumentasikan): PostgREST tak punya `SELECT FOR UPDATE`, dua admin submit bersamaan bisa lolos guard → stok negatif. Untuk skala ~20 staff kecil kemungkinannya, tapi nyata.
- **Fix (jika race jadi masalah):** pindahkan guard+insert ke Postgres function `SECURITY DEFINER` dengan `FOR UPDATE`.

Objek DB yang menjalankan logika: `generate_po_number()` & trigger `set_updated_at()`. **Verifikasi** keduanya tidak `SECURITY DEFINER` dengan `search_path` mutable (peringatan advisor Supabase umum) via `get_advisors(type: security)`.

---

### e. Auth

**e1 — `login` abaikan `is_active` (🟠 Med).** `login()` (`routers/auth.py:59-75`) ambil `id, email, role` dari `users` **tanpa filter `is_active`**. User nonaktif tetap bisa login & dapat token admin 12 jam. `require_admin`/`require_owner` juga hanya cek klaim `role`. **Fix:** tambah `.eq("is_active", True)` di query login.

**e2 — `GET /units` tanpa auth (🟡 Low).** `GET /units` & `GET /units/{id}` (`routers/units.py:16-33`) tidak punya dependency auth. Ekspos kecil (nama/simbol unit) tapi inkonsisten. **Fix:** tambah `user=Depends(get_current_user)`.

**Positif & minor.** Password ditangani Supabase Auth — **tidak ada kolom/hash password di `users`**. `PrivateRoute` (`App.jsx:25`) hanya cek keberadaan token (OK — tiap endpoint backend menegakkan JWT; guard client hanya UX). JWT HS256 12 jam **tidak bisa dicabut** sebelum kedaluwarsa (tak ada blocklist) — untuk skala ini dapat diterima.

---

## TUGAS 2 — Progress Report

### Kematangan modul

| Area | Status | Catatan |
|------|--------|---------|
| Auth & 2-role (admin/owner) | 🟢 Matang | Supabase Auth + JWT sendiri; perbaiki cek `is_active` |
| Master data (ingredients, menu, recipe/BOM, vendor, unit, production process) | 🟢 Matang | CRUD lengkap + bulk import Excel |
| Belanja harian / goods receipt + purchase_unit conversion | 🟢 Matang | quick-entry, edit/delete, avg_cost recompute cascade |
| Stok ledger 6-lokasi + storage/division split + transfer | 🟢 Matang | pure ledger, guard stok, halaman Transfer |
| Sales entry → theoretical_consumption | 🟢 Matang | entry_type sale/comp/test, snapshot-rollback |
| Production batch + multi-stage yield | 🟡 Kode matang, data kosong | hanya 1 chain (Gula Cair); 11 chain kitchen belum ada |
| Opname harian + variance + auto-flag 5% | 🟢 Matang | termasuk production_in normalisasi & waste |
| Stock adjustment (rekonsiliasi ledger↔opname) | 🟢 Matang | idempoten, sengaja tanpa guard |
| Waste log | 🟢 Matang | enum reason di DB, guard stok |
| HPP + weighted avg cost + food cost % + breakdown | 🟡 Kode matang, hasil belum akurat | terblokir data harga & selling_price |
| Dashboard, HPP Analysis, Variance report, Reports (PDF/Excel) | 🟢 Matang | Realtime dashboard berisiko mati kalau RLS dibetulkan (a) |
| RLS / hardening keamanan | 🔴 Belum | temuan utama Tugas 1 |

### Coverage alur raw → processed → porsi jual

- **Raw masuk** 🟢 — goods receipt (quick-entry + PO) + initial stock + konversi `purchase_unit → base_unit`. Lengkap.
- **Raw → processed** 🟡 — mesin produksi (batch, cumulative yield, normalisasi unit, guard) **sudah jalan**, tapi baru **1 dari 12 chain** dikonfigurasi (Gula Cair). 11 chain kitchen belum dibuat — menunggu yield% dari kitchen.
- **Processed → porsi jual** 🟡 — BOM bar lengkap (219 recipe, 54 menu), konsumsi teoretis + variance jalan penuh untuk bar. BOM & menu kitchen **belum ada** — menunggu data.
- **HPP end-to-end** 🔴 belum akurat — logika benar, output belum bermakna sampai tiga input terisi (lihat blocker).

### Technical debt & bug terbuka

1. **RLS tidak ditegakkan** (High) — temuan a; blocker keamanan sebelum data biaya nyata masuk.
2. **Guard stok app-layer & race-prone** (Med) — tanpa DB lock; bisa dilewati direct write.
3. **`login` abaikan `is_active`** (Med) — user nonaktif tetap bisa masuk.
4. **Secret di OneDrive tanpa `.gitignore`** (Med) — rawan bocor saat git init.
5. **`ENVIRONMENT=development`** — pastikan `production` di server (docs & CORS).
6. **`GET /units` tanpa auth** (Low) + **tak ada batas atas kuantitas** + **`portions_actual` bisa negatif** (Low).
7. **Realtime vs RLS** — subscription anon kemungkinan sudah tidak berfungsi; perlu keputusan polling vs Supabase session.
8. **Overdue data kitchen** — CLAUDE.md menargetkan data kitchen 5 Juli 2026; per 21 Juli sudah lewat ~2 minggu. Menahan seluruh sisi kitchen.

### Rekomendasi urutan kerja (prioritas blocker HPP akurat)

1. **Kunci RLS** (a) + rotasi secret + `.gitignore`. Sebelum harga/HPP nyata masuk — murah & menutup celah terbesar. Sekalian putuskan nasib Realtime.
2. **Perbaiki `is_active` di login** + auth `GET /units` + batas atas kuantitas. Patch kecil, cepat.
3. **Isi `selling_price` 54 menu bar** (kini placeholder = 1). HPP% = HPP/selling_price → tanpa ini food-cost% ngawur. Tugas admin, app siap.
4. **Goods receipt pertama untuk mengisi `avg_cost`** (kini 0 mayoritas ingredient). Begitu ada receipt, weighted-avg + HPP recalc otomatis. **→ Setelah #3 & #4, HPP bar langsung akurat.**
5. **Data kitchen** (overdue): seed ingredient + menu + BOM kitchen, lalu 11 production chain + yield%. Membuka HPP sisi kitchen. Tergantung input kepala kitchen.
6. **(Opsional) Pindah guard stok ke RPC `FOR UPDATE`** hanya jika race multi-admin terbukti masalah nyata.

Langkah 1-4 bisa dikerjakan sekarang tanpa menunggu kitchen; #3-4 adalah jalur tercepat menuju HPP akurat untuk 54 menu bar.

---

*Tidak ada kode yang diubah dalam review ini — semua di atas adalah rekomendasi.*
