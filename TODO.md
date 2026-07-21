# TODO

## Keamanan / RLS (follow-up hardening 2026-07-21)

- [ ] **Rotate service_role key Supabase** (Langkah 3 yang ditunda — tidak urgent:
  key tidak pernah publik, sumber kebocoran lokal sudah dibersihkan, RLS sudah aktif).
  Rekomendasi: **Jalur B** — migrasi ke API keys baru (`sb_secret_...`) di
  Supabase dashboard (Settings > API), lalu rotate secret key-nya. Dengan jalur ini
  anon/publishable key tidak berubah dan frontend tidak perlu di-build ulang.
  Setelah rotate: update `SUPABASE_SERVICE_ROLE_KEY` + `SUPABASE_ANON_KEY` di
  (1) `backend/.env` lokal dan (2) env vars project Vercel **berlaris-api** →
  lalu Redeploy. `JWT_SECRET` TIDAK perlu diganti (milik FastAPI sendiri, bukan
  JWT secret Supabase). supabase-py sudah 2.31.0 — support `sb_secret_`.

- [ ] **Redeploy backend `berlaris-api`** setelah env `ENVIRONMENT=production`
  diperbaiki (per 2026-07-21 malam `/docs` masih terbuka karena deploy terakhir
  belum memakai env baru).

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

## Deployment (live sejak 2026-07-21)

- Repo: `github.com/dioariaa/berlaris-inventory` (PRIVATE) — push ke `main` = auto-deploy.
- Frontend: **https://berlaris.vercel.app** (Vercel project `berlaris`, root `frontend`,
  env `VITE_API_BASE_URL=https://berlaris-api.vercel.app`).
- Backend: **https://berlaris-api.vercel.app** (Vercel project `berlaris-api`, root
  `backend`, Python serverless via `api/index.py` + `vercel.json`; 6 env vars).
- CORS default backend = `https://berlaris.vercel.app`; override via env `ALLOWED_ORIGINS`
  (comma-separated) tanpa ubah kode.
- render.yaml tersisa sebagai alternatif (Render butuh kartu — batal dipakai).
