# Konteks Import Resep — Berlaris Inventory (snapshot DB 2026-07-21)

> Dokumen self-contained untuk sesi Claude chat. Tujuan: mapping ~400 baris resep
> (bumbu base, sambal, sauce) dari Excel ke item master & BOM. Semua data di bawah
> hasil inspeksi read-only DB production (Supabase ref `xvzujceymyozqztdongm`).

## Sistem (ringkas)

- Stack: FastAPI (`berlaris-api.vercel.app`) + React (`berlaris.vercel.app`) + Supabase.
- RLS default-deny aktif di semua 27 tabel — akses data HANYA via backend (service_role).
- Item master = tabel **`ingredients`**, BOM = tabel **`recipes`** (terikat menu).
- Endpoint import massal yang sudah ada: `POST /menus/bulk-import` (Excel, kolom:
  Menu, Bahan, Qty, Satuan — pandas, untuk BOM **menu**, bukan resep antara).

## Schema `ingredients` (94 baris)

`id` uuid · `name` · `ingredient_type` (raw|processed|packaging) · `division`
(bar|kitchen|both) · `base_unit_id` FK→units · `portion_size_g` · `min_threshold` ·
`avg_cost_per_unit` · `is_active` · `notes` · `package_size` (text info kemasan) ·
`purchase_unit` + `conversion_factor` (beli dalam unit lain → dikonversi ke base) ·
timestamps.

- TIDAK ada kolom `alias` / `sku`.
- Distribusi: 83 raw / 9 packaging / 2 processed · **91 bar / 2 kitchen / 1 both** · 91 aktif.

## Schema `recipes` (219 baris terisi — BOM 54 menu bar)

`id` · `menu_id` FK→menu_items (**wajib — selalu terikat menu**) · `ingredient_id` ·
`qty` · `unit_id` · `notes`. Plus `recipe_change_log` (audit, 43 baris).
`production_processes` (2 baris): transformasi **1 raw → 1 output** + yield stages —
BUKAN untuk komposisi multi-bahan.

## ⚠ KEPUTUSAN DESAIN YANG BELUM DIAMBIL (blocker mapping)

Bumbu base / sambal / sauce = **resep antara multi-bahan** (mis. 10 bahan → 1 bumbu).
Schema saat ini TIDAK punya struktur untuk itu. Opsi:
1. **Flatten** — komponen bumbu langsung dimasukkan ke BOM menu final (tanpa entitas bumbu).
2. **Extend schema** — bumbu jadi ingredient `processed` + tabel komposisi multi-input baru.
3. Bumbu sebagai "menu" internal — hacky, tidak disarankan.

## Hasil cek duplikat (keyword, case-insensitive)

- `knorr/royko/roico`: **0 match** · `bombai/bombay`: **0** · `micin/mecin/msg`: **0** · `bawang`: **0**
- `santan/sasa`: **1** — `Santan` (id `d066604e..`, unit g, division **bar**, cost placeholder Rp 1,
  belum pernah dipakai transaksi). **Perlu keputusan chef**: reuse untuk kitchen (division→both) atau buat baru.
- Konteks: item kitchen dihapus saat reset 2026-06-30, belum di-seed ulang. Kitchen existing
  hanya: `Daun Jeruk` (pcs), `Jahe` (g), `Timun` (both, g). → ~400 baris import praktis semua
  **insert baru**; dedup utamanya DI DALAM Excel sendiri.

### Near-duplicate existing (hygiene, di luar keyword)

- `Powder Chocolatte (Vanhoutten` (typo, **aktif**) vs `Powder Coklat Vanhouten` (nonaktif)
  vs `Powder Coklat Vilo` (nonaktif) — kondisi terbalik dari dokumentasi, perlu dibereskan.
- Ejaan campur: `Sirup ...` (7 item) vs `Syrup Asam Jawa 3 Teko` / `Syrup Asam Jawa GKC`.
- Trio air: `Air Mineral` (processed, ml) / `Air Mineral Galon` (raw, ml) / `Amidis Botol` (btl).

## Konvensi satuan

Tabel `units` (17): L, bh, btl, dus, ekr, g, gal, jrg, kal, kg, lbr, ml, pax, pcs, pk, prs, sct.

Base unit yang dipakai ingredients: **g×55, ml×18, pcs×16**, kg×2 (Alpukat, Jeruk Nipis —
outlier), btl×2, pax×1. **Konvensi de-facto: g/ml untuk timbang, pcs untuk hitung.**
`ekor`/`lembar` tersedia tapi belum terpakai. Pembelian unit besar → pakai
`purchase_unit`+`conversion_factor` per item, base unit tetap g/ml.

**Rekomendasi untuk import**: semua bahan timbang di **g** (cairan **ml**), hitung di **pcs**;
jangan ikuti outlier kg.

## Daftar lengkap 94 item existing (nama | type | div | unit)

Packaging (bar, semua pcs): Gula Aren Stick 6gr · Gula Pasir Sachet 6gr · Hot Cup 8oz ·
Ice Cup 16oz · Plastik Take Away Double · Plastik V60 · Sedotan Bubble · Sedotan Steril ·
Tropicana Slim

Processed (bar): Air Mineral (ml) · Gula Cair (ml, NONAKTIF)

Raw bar (g kecuali dicatat): Air Mineral Galon (ml) · Alpukat (kg) · Amidis Botol (btl) ·
Anistar · Arabica Bali Kintamani · Arabica Blueberry · Arabica Flores · Arabica Gayo ·
Arabica Halu Banana · Arabica Kerinci · Biji Selasih · Buah Lychee (pcs) · Cengkeh ·
Coffee Beans Houseblend · Cream Charges (pcs) · Creamer Thailand · Daun Mint · Es Batu (pax) ·
Es Krim Coklat · Es Krim Strawberry · Es Krim Vanilla · Fresh Milk (ml) · Gula Batu ·
Gula Pasir · Hydro Coco · Jelly Cincau · Jeruk Medan (ml) · Jeruk Nipis (kg) ·
Jeruk Peras (ml) · Kapulaga · Kayu Manis · Kayu Secang · Kolang Kaling · Lemon ·
Lemon Lokal Slice · Lump Sugar · Lychee Kaleng · Melon (ml) · Milo Powder · Nanas · Nangka ·
Nata De Coco · Nutrijel · Oreo Crumb · Palm Sugar · Powder Avocado ·
Powder Chocolatte (Vanhoutten [typo] · Powder Coklat Vanhouten [NONAKTIF] ·
Powder Coklat Vilo [NONAKTIF] · Powder Matcha · Robusta Temanggung · Sagu Mutiara · Santan ·
Savis Mango Tea (pcs) · Schweppes (pcs) · Semangka · Sereh · Sirup Blue Curacao (ml) ·
Sirup Butterscotch · Sirup Caramel (ml) · Sirup Hazelnut (ml) · Sirup Lychee (ml) ·
Sirup Marjan Cocopandan (ml) · Sirup Peppermint (ml) · Sirup Vanila (ml) · Strawberry ·
Susu Evaporasi · Susu Kental Manis (ml) · Syrup Asam Jawa 3 Teko (ml) ·
Syrup Asam Jawa GKC (ml) · Tape · Tea Goalpara · Teh Chamomile Sachet (pcs) ·
Teh Peppermint Sachet (pcs) · Teh Thai · Topping Caramel · Topping Coklat ·
Topping Strawberry · Whipping Cream (ml) · Yakult (btl)

Raw kitchen: Daun Jeruk (pcs) · Jahe (g) — Raw both: Timun (g)

## State transaksi (konteks)

daily_sales_entries 330 · receipt_items 95 · daily_stock_opname 94 ·
theoretical_consumption **2** (⚠ janggal vs 330 sales — sedang diinvestigasi terpisah,
JANGAN dipakai sebagai sinyal "last used") · production_batches 1 · waste_logs 2 ·
stock_transfers 3.

## Aturan main untuk sesi import

1. Fase mapping = read-only; insert hanya setelah mapping disetujui user.
2. Insert lewat backend/endpoint yang ada (atau script service_role yang mengikuti
   konvensi services/) — JANGAN raw SQL yang melewati audit log.
3. Nama item baru: ikuti kapitalisasi Title Case existing, satu konvensi ejaan (pilih `Sirup`).
4. `avg_cost_per_unit` biarkan 0 saat insert — harga masuk via Belanja Harian/goods receipt.
5. Initial stock bahan baru: via fitur Initial Stock / opname — BUKAN di-hardcode.
