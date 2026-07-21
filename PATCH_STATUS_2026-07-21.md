# Berlaris — Status Patch & Connector (2026-07-21)

Catatan kerja untuk lanjutan sesi. Merangkum patch yang sudah disiapkan dan
hasil cek connector Supabase terakhir.

---

## 1. Patch yang sudah dikerjakan

### a. Fix `is_active` — SUDAH diedit di kode
**File:** `backend/app/routers/auth.py`

- `login()` — `select` kini menyertakan `is_active`; setelah kredensial Supabase
  Auth lolos, user dengan `is_active = false` ditolak **403 "Akun Anda
  dinonaktifkan — hubungi admin"** (sebelumnya tetap dapat token admin 12 jam).
- `refresh_token()` — cek `is_active` yang sama, supaya user nonaktif tidak bisa
  memperpanjang sesi.

Status: **teredit, belum dites** (butuh koneksi DB Berlaris untuk uji jalan).

### b. Patch RLS — file migration SUDAH dibuat
**File:** `berlaris_migration_rls_hardening.sql`

- Enable RLS di **27 tabel** `public` (idempotent, aman diulang).
- **Tanpa policy** untuk anon/authenticated → default-deny. FastAPI pakai
  service_role yang bypass RLS, jadi backend tetap berfungsi penuh.
- Blok opsional Realtime: Opsi A (buang Realtime → polling, rekomendasi) atau
  Opsi B (frontend login Supabase Auth + policy SELECT ke `authenticated` saja,
  JANGAN ke `anon`).
- Ada query verifikasi di akhir file.

Status: **siap apply.** Belum dijalankan ke DB (connector belum tembus — lihat §2).

---

## 2. Cek connector Supabase — hasil terakhir

**Kesimpulan: connector Supabase belum terbaca di sesi ini.**

Yang dicoba (2026-07-21, setelah user mengganti connector):
1. Panggil tools lewat server ID lama (`2a525747-…`) → **tidak tersedia**
   (server lama sudah disconnect).
2. Cari tool `apply_migration` / `execute_sql` / `get_advisors` by-name → **nihil**.
3. Cari keyword "supabase" (list_projects, list_tables, advisor, migration) → **nihil**.

**Sebab kemungkinan besar:** connector MCP yang baru diganti/diotorisasi **tidak
hot-reload** ke sesi yang sedang berjalan. Sesi Claude Code perlu **di-restart**
(keluar lalu `claude` lagi) supaya tools connector baru ter-load.

**Konteks penting dari sesi sebelumnya:** saat connector lama masih hidup, ia hanya
punya akses ke project **"CutiProject"** (`opnkfxycxfayggcomohm`). Project Berlaris
(`xvzujceymyozqztdongm`, yang dipakai app ini per `backend/.env`) menjawab
**"permission denied"**. Jadi pastikan connector baru memakai akun/token yang
**pemilik org project `xvzujceymyozqztdongm`** — kalau bukan, `list_projects`
tetap tidak akan menampilkan Berlaris.

---

## 3. Langkah berikutnya (setelah restart sesi + connector tembus)

Begitu tools Supabase muncul, urutan cek:

1. `list_projects` → konfirmasi project `xvzujceymyozqztdongm` muncul (bukan cuma
   CutiProject).
2. `list_tables` + query verifikasi RLS → lihat tabel mana yang masih
   `rls_enabled = false`.
3. `get_advisors(type: security)` → tangkap missing-RLS + isu `SECURITY DEFINER` /
   `search_path` mutable otomatis.
4. Apply `berlaris_migration_rls_hardening.sql` (lewat `apply_migration`, atau
   tempel manual di SQL Editor project Berlaris).
5. Jalankan ulang query verifikasi → pastikan semua `rls_enabled = true`.

Query verifikasi RLS (bisa langsung ditempel di SQL Editor tanpa menunggu connector):

```sql
SELECT c.relname AS tabel,
       c.relrowsecurity AS rls_enabled,
       (SELECT count(*) FROM pg_policies p
         WHERE p.schemaname = 'public' AND p.tablename = c.relname) AS jml_policy
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r'
ORDER BY c.relrowsecurity, tabel;
```

---

## 4. Patch low-risk yang masih menunggu (opsional, belum dikerjakan)

- `GET /units` & `GET /units/{id}` (`routers/units.py:16-33`) — tambah
  `Depends(get_current_user)`.
- Model Pydantic — tambah batas atas kuantitas (mis. `Field(gt=0, le=1_000_000)`)
  dan `ge=0` pada `production.portions_actual`.

Referensi lengkap temuan: `SECURITY_REVIEW_2026-07-21.md`.
