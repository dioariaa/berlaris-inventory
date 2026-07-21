# RLS Pre-flight Check — 2026-07-21

Hasil investigasi **read-only** sebelum apply `berlaris_migration_rls_hardening.sql`
ke DB produksi (Supabase ref: `xvzujceymyozqztdongm`).
Tidak ada migration yang di-apply. Satu-satunya file yang dibuat:
`berlaris_migration_rls_rollback.sql`.

---

## VERDICT: ✅ AMAN apply default-deny

Frontend **tidak punya** jalur baca/tulis data langsung ke Supabase.
Semua data lewat FastAPI (service_role, bypass RLS). Direct access dari
frontend hanya Realtime *signal* (anon) yang payload-nya tidak dipakai
sebagai data — cuma trigger refetch.

Efek samping satu-satunya setelah hardening: **Realtime auto-refresh
berhenti diam-diam** di Dashboard & StockLevels. Halaman tetap berfungsi
normal (load awal + refresh manual). Solusi: Opsi A (polling) — lihat
catatan Opsi B di bawah.

> **Migration ini TIDAK menghapus data apa pun.**
> `ENABLE/DISABLE ROW LEVEL SECURITY` dan `DROP POLICY` hanya mengubah
> aturan akses, bukan isi tabel. Bisa apply ↔ rollback bolak-balik tanpa
> kehilangan satu baris pun.

---

## Tugas 1 — Kebocoran service_role key

| Check | Hasil |
|---|---|
| `frontend/src` | ✅ Bersih — hanya anon key via `import.meta.env` |
| `frontend/dist` (build output) | ✅ Bersih dari service_role & JWT_SECRET. Hanya **anon key** ter-bundle di `dist/assets/index-Bj48l259.js` (by-design Supabase, memang publik — inilah alasan RLS wajib) |
| Git history (`git log --all -p`) | **N/A — project BUKAN git repository.** Tidak ada `.git` di root maupun subfolder. Tidak ada history, tidak ada remote, tidak pernah ter-push ke mana pun |
| `backend/.env` di `.gitignore` | N/A — `.gitignore` tidak ada (bukan repo). ⚠ Kalau nanti `git init`, WAJIB gitignore `backend/.env` & `frontend/.env` SEBELUM commit pertama |
| `node_modules/@supabase/auth-js` match "service_role" | False positive — string literal di type definitions library, bukan key |

### ⚠ Temuan nyata (local-only, belum ter-publish)

Service_role key **lengkap, hardcoded plaintext** (plus password admin —
nilainya tidak ditulis di sini) di 5 script test lama di root project:

- `test_avg_cost.py:30`
- `test_consumption.py:30`
- `test_hpp.py:47`
- `test_opname.py:34`
- `test_production_batches.py:25`

`backend/tests/` bersih (key hanya di `backend/.env`, sebagaimana mestinya).

Catatan risiko:
1. Folder project tersinkron **OneDrive** → key & `.env` ikut naik ke cloud
   OneDrive akun pribadi. Bukan publik, tapi perlu disadari.
2. Kalau repo di-init dan di-push tanpa membersihkan 5 file itu → key
   langsung bocor.

Saran (belum dikerjakan): ubah 5 script agar baca key dari env var, atau
hapus kalau sudah digantikan `backend/tests/`.

---

## Tugas 2 — Pola akses Supabase di frontend

Client: `frontend/src/lib/supabase.js` — `createClient` dengan **anon key**.

**Nol** pemakaian `.from()`, `.rpc()`, atau `supabase.auth` — tidak ada
query/mutasi langsung ke PostgREST. Semua data via axios → FastAPI.

Direct access HANYA Realtime subscription (role `anon`):

| File | Tabel | Event |
|---|---|---|
| `Dashboard.jsx:266` | `variance_reports`, `daily_stock_opname`, `production_batches` | INSERT |
| `StockLevels.jsx:10` | `receipt_items`, `production_batches`, `theoretical_consumption`, `waste_logs`, `stock_transfers` | * |

Union: **7 tabel**, semua hanya sebagai sinyal refetch.

### Catatan Opsi B

1. **Opsi B praktis tidak applicable saat ini** — frontend tidak pernah
   login ke Supabase Auth (login via FastAPI JWT), jadi koneksi Realtime
   selamanya berjalan sebagai `anon`, bukan `authenticated`. Policy
   `TO authenticated` tidak akan pernah kepakai tanpa perombakan auth.
   → **Opsi A (polling) adalah jalur yang realistis.**
2. **Diskrepansi di file migration**: blok komentar Opsi B hanya mencakup
   5 tabel — kurang `theoretical_consumption` dan `waste_logs` yang juga
   di-subscribe `StockLevels.jsx`. Kalau suatu hari Opsi B dipilih, dua
   tabel itu perlu ditambahkan.

---

## Tugas 3 — Rollback script ✅

`berlaris_migration_rls_rollback.sql` — sudah dibuat:

- `ALTER TABLE public.<tabel> DISABLE ROW LEVEL SECURITY;` untuk **27 tabel
  persis** sesuai daftar & urutan di `berlaris_migration_rls_hardening.sql`
  (bukan ditebak).
- `DROP POLICY IF EXISTS` untuk 5 policy Opsi B (no-op kalau tidak pernah
  dibuat).
- Query verifikasi `pg_class`/`pg_policies` di akhir.
- Idempotent — aman dijalankan ulang.

---

## Next steps (menunggu keputusan)

1. Apply `berlaris_migration_rls_hardening.sql` di Supabase SQL Editor
   (verifikasi bawaan: semua `rls_enabled = true`).
2. Ganti Realtime → polling di `Dashboard.jsx` & `StockLevels.jsx` (Opsi A).
3. Bersihkan service_role key dari 5 script test root.
4. (Opsional) Rotate service_role key di Supabase dashboard setelah
   dibersihkan, untuk memutus paparan lama.
