# TODO

## Keamanan / RLS (follow-up hardening 2026-07-21)

- [ ] **Rotate service_role key Supabase** (Langkah 3 yang ditunda — tidak urgent:
  key tidak pernah publik, sumber kebocoran lokal sudah dibersihkan, RLS sudah aktif).
  Rekomendasi: **Jalur B** — migrasi ke API keys baru (`sb_secret_...`) di
  Supabase dashboard (Settings > API), lalu rotate secret key-nya. Dengan jalur ini
  anon/publishable key tidak berubah dan frontend tidak perlu di-build ulang.
  Setelah rotate: update `SUPABASE_SERVICE_ROLE_KEY` di `backend/.env` + env vars
  hosting backend (Railway/Render), lalu restart backend. `JWT_SECRET` TIDAK perlu
  diganti (milik FastAPI sendiri, bukan JWT secret Supabase). Cek dulu versi
  `supabase-py` menerima key `sb_secret_`; kalau tidak, pakai rotasi legacy JWT
  secret — tapi itu mengubah anon key juga (lihat checklist di percakapan/dok).

- [ ] **Kalau project di-git-init**: masukkan `backend/.env`, `frontend/.env`,
  dan `.env.test` ke `.gitignore` SEBELUM commit pertama.

- Opsional: `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` di `frontend/.env`
  sudah tidak dipakai (frontend 100% via FastAPI sejak 2026-07-21) — boleh dihapus.

## Catatan arsitektur — Realtime & Opsi B

Opsi B (RLS policy untuk authenticated Realtime) belum applicable karena frontend
belum pakai Supabase Auth langsung (login masih via FastAPI JWT). Frontend sekarang
pakai polling 15 detik (Dashboard.jsx, StockLevels.jsx) dan sudah tidak dependency
ke supabase-js sama sekali. Revisit kalau auth di-refactor nanti — saat itu
`authenticated` policy perlu ditambah 2 tabel yang belum tercakup di draft awal
blok Opsi B `berlaris_migration_rls_hardening.sql`: `theoretical_consumption`
dan `waste_logs` (keduanya dulu di-subscribe StockLevels.jsx).

Rollback RLS (emergency): `berlaris_migration_rls_rollback.sql`.
Laporan lengkap: `RLS_PREFLIGHT_2026-07-21.md`.
