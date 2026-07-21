-- ============================================================
-- berlaris_data_p4t1.sql
-- P4-T1: Standardisasi nama ingredient bar + insert 16 bahan baru
--
-- Jalankan di Supabase SQL Editor (full script, satu kali run).
-- IDEMPOTENT: aman dijalankan ulang — INSERT menggunakan ON CONFLICT,
-- merge function cek existence sebelum act.
--
-- Mencakup:
--   1. Tambah unit 'kaleng'
--   2. Merge/rename ingredient bar yang namanya tidak konsisten
--   3. Rename garnish ingredients (strip prefix GARNISH/GARNIS/BUAH)
--   4. Fix typo nama menu bar
--   5. Insert 16 ingredient bar baru
--   6. Production process: Gula Pasir → Gula Cair
--   7. Cleanup function sementara
-- ============================================================

BEGIN;


-- ============================================================
-- BAGIAN 1: Tambah unit yang belum ada
-- ============================================================
INSERT INTO units (name, symbol)
VALUES ('kaleng', 'kal')
ON CONFLICT (name) DO NOTHING;


-- ============================================================
-- BAGIAN 2: Helper function untuk merge ingredient
--
-- Logika:
--   - Cari apakah canonical_name sudah ada → pakai itu sebagai pivot
--   - Kalau belum ada, rename variant pertama yang ditemukan → canonical
--   - Semua variant lain: pindahkan semua FK references ke canonical, lalu DELETE
--   - Handle UNIQUE constraints:
--       recipes(menu_id, ingredient_id): aggregate qty kalau conflict
--       daily_stock_opname(opname_date, ingredient_id): drop dup row
--       theoretical_consumption(consumption_date, ingredient_id): drop dup row
--       variance_reports(report_date, ingredient_id): drop dup row
-- ============================================================
CREATE OR REPLACE FUNCTION _berlaris_merge_ingredient(
  p_canonical TEXT,
  p_variants  TEXT[]   -- nama-nama lama (case-insensitive)
) RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE
  _cid UUID;   -- canonical id
  _dup RECORD; -- dup ingredient record
  _r   RECORD; -- row dari FK table
BEGIN

  -- 1. Cari canonical yang sudah ada (exact, case-insensitive)
  SELECT id INTO _cid
  FROM ingredients
  WHERE LOWER(name) = LOWER(p_canonical)
  LIMIT 1;

  -- 2. Iterasi semua variant
  FOR _dup IN
    SELECT * FROM ingredients
    WHERE name ILIKE ANY(p_variants)
      AND (_cid IS NULL OR id <> _cid)
    ORDER BY created_at  -- prefer older record kalau ada pilihan
  LOOP

    -- Kalau canonical belum ada: promote _dup jadi canonical
    IF _cid IS NULL THEN
      UPDATE ingredients SET name = p_canonical WHERE id = _dup.id;
      _cid := _dup.id;
      RAISE NOTICE '[merge] Promoted % → %', _dup.name, p_canonical;
      CONTINUE;
    END IF;

    -- ── Merge _dup.id → _cid ──

    -- recipes (UNIQUE menu_id, ingredient_id): aggregate qty on conflict
    FOR _r IN SELECT * FROM recipes WHERE ingredient_id = _dup.id LOOP
      IF EXISTS (
        SELECT 1 FROM recipes
        WHERE menu_id = _r.menu_id AND ingredient_id = _cid
      ) THEN
        UPDATE recipes SET qty = qty + _r.qty
        WHERE menu_id = _r.menu_id AND ingredient_id = _cid;
        DELETE FROM recipes WHERE id = _r.id;
      ELSE
        UPDATE recipes SET ingredient_id = _cid WHERE id = _r.id;
      END IF;
    END LOOP;

    -- daily_stock_opname (UNIQUE opname_date, ingredient_id): drop dup on conflict
    FOR _r IN SELECT * FROM daily_stock_opname WHERE ingredient_id = _dup.id LOOP
      IF EXISTS (
        SELECT 1 FROM daily_stock_opname
        WHERE opname_date = _r.opname_date AND ingredient_id = _cid
      ) THEN
        DELETE FROM daily_stock_opname WHERE id = _r.id;
      ELSE
        UPDATE daily_stock_opname SET ingredient_id = _cid WHERE id = _r.id;
      END IF;
    END LOOP;

    -- theoretical_consumption (UNIQUE consumption_date, ingredient_id)
    FOR _r IN SELECT * FROM theoretical_consumption WHERE ingredient_id = _dup.id LOOP
      IF EXISTS (
        SELECT 1 FROM theoretical_consumption
        WHERE consumption_date = _r.consumption_date AND ingredient_id = _cid
      ) THEN
        DELETE FROM theoretical_consumption WHERE id = _r.id;
      ELSE
        UPDATE theoretical_consumption SET ingredient_id = _cid WHERE id = _r.id;
      END IF;
    END LOOP;

    -- variance_reports (UNIQUE report_date, ingredient_id)
    FOR _r IN SELECT * FROM variance_reports WHERE ingredient_id = _dup.id LOOP
      IF EXISTS (
        SELECT 1 FROM variance_reports
        WHERE report_date = _r.report_date AND ingredient_id = _cid
      ) THEN
        DELETE FROM variance_reports WHERE id = _r.id;
      ELSE
        UPDATE variance_reports SET ingredient_id = _cid WHERE id = _r.id;
      END IF;
    END LOOP;

    -- Tables without conflicting unique constraints: simple UPDATE
    UPDATE ingredient_vendors       SET ingredient_id     = _cid WHERE ingredient_id       = _dup.id;
    UPDATE po_items                 SET ingredient_id     = _cid WHERE ingredient_id       = _dup.id;
    UPDATE receipt_items            SET ingredient_id     = _cid WHERE ingredient_id       = _dup.id;
    UPDATE ingredient_cost_history  SET ingredient_id     = _cid WHERE ingredient_id       = _dup.id;
    UPDATE production_processes     SET raw_ingredient_id = _cid WHERE raw_ingredient_id   = _dup.id;
    UPDATE production_processes     SET output_ingredient_id = _cid WHERE output_ingredient_id = _dup.id;
    UPDATE production_outputs       SET output_ingredient_id = _cid WHERE output_ingredient_id = _dup.id;

    RAISE NOTICE '[merge] Merged % (%) → % (%)', _dup.name, _dup.id, p_canonical, _cid;
    DELETE FROM ingredients WHERE id = _dup.id;

  END LOOP;

  RETURN format('[merge] Done: %s (id: %s)', p_canonical, COALESCE(_cid::TEXT, 'NOT FOUND IN DB'));
END;
$$;


-- ============================================================
-- BAGIAN 3: Standardisasi nama ingredient bar
-- ============================================================

-- FRESH MILK / FRESHMILK → Fresh Milk
SELECT _berlaris_merge_ingredient(
  'Fresh Milk',
  ARRAY['FRESH MILK','FRESHMILK','Fresh milk','fresh milk','freshmilk']
);

-- BEANS COFFEE / BEANS COFFE → Coffee Beans Houseblend
SELECT _berlaris_merge_ingredient(
  'Coffee Beans Houseblend',
  ARRAY['BEANS COFFEE','BEANS COFFE','BEANS COFEE','beans coffee','beans coffe']
);

-- WHIPING CREAM / WHIPED CREAM → Whipping Cream
SELECT _berlaris_merge_ingredient(
  'Whipping Cream',
  ARRAY['WHIPING CREAM','WHIPED CREAM','WHIPPING CREAM','whipping cream','whiping cream','whiped cream']
);

-- NATA DECOCO / NATA DE COCO → Nata De Coco
SELECT _berlaris_merge_ingredient(
  'Nata De Coco',
  ARRAY['NATA DECOCO','NATA DE COCO','nata decoco','nata de coco']
);

-- SURUP LYCHEE → Sirup Lychee
SELECT _berlaris_merge_ingredient(
  'Sirup Lychee',
  ARRAY['SURUP LYCHEE','SIRUP LYCHEE','surup lychee','sirup lychee']
);

-- SIRUP BLUE CITRUS → Sirup Blue Curacao
SELECT _berlaris_merge_ingredient(
  'Sirup Blue Curacao',
  ARRAY['SIRUP BLUE CITRUS','sirup blue citrus','SIRUP BLUE CURACAO','sirup blue curacao','BLUE CITRUS','BLUE CURACAO']
);

-- ICE CREAM VANILA / VANILA ICE CREAM / ICE CREAM → Es Krim Vanilla
SELECT _berlaris_merge_ingredient(
  'Es Krim Vanilla',
  ARRAY['ICE CREAM VANILA','VANILA ICE CREAM','ICE CREAM','VANILLA ICE CREAM',
        'ice cream vanila','vanila ice cream','ice cream','vanilla ice cream',
        'ICE CREAM VANILLA','Es Krim Vanilla','es krim vanilla']
);

-- POWDER CHOCOLATE / POWDER COKLAT / COCOA POWDER → Chocolate Powder
SELECT _berlaris_merge_ingredient(
  'Chocolate Powder',
  ARRAY['POWDER CHOCOLATE','POWDER COKLAT','COCOA POWDER','COKLAT POWDER',
        'powder chocolate','powder coklat','cocoa powder','coklat powder']
);

-- CONDENSED MILK / SUSU KENTAL MANIS → Susu Kental Manis
SELECT _berlaris_merge_ingredient(
  'Susu Kental Manis',
  ARRAY['CONDENSED MILK','condensed milk','SUSU KENTAL MANIS','susu kental manis']
);


-- ============================================================
-- BAGIAN 4: Rename garnish ingredients (strip prefix)
-- GARNISH X / GARNIS X / BUAH X → nama buahnya saja (Title Case)
-- Kalau ingredient tanpa prefix sudah ada → merge ke sana
-- ============================================================
DO $$
DECLARE
  _ing       RECORD;
  _fruit     TEXT;
  _cid       UUID;
  _r         RECORD;
BEGIN
  FOR _ing IN
    SELECT * FROM ingredients
    WHERE (name ~* '^(GARNISH|GARNIS|BUAH)\s+')
      AND division IN ('bar', 'both')
  LOOP
    -- Ekstrak nama buah (strip prefix, convert ke Title Case via initcap)
    _fruit := initcap(
      trim(regexp_replace(_ing.name, '^(GARNISH|GARNIS|BUAH)\s+', '', 'i'))
    );

    -- Cek apakah nama buah sudah ada
    SELECT id INTO _cid
    FROM ingredients
    WHERE LOWER(name) = LOWER(_fruit) AND id <> _ing.id
    LIMIT 1;

    IF _cid IS NULL THEN
      -- Aman: rename saja
      UPDATE ingredients SET name = _fruit WHERE id = _ing.id;
      RAISE NOTICE '[garnish] Renamed: % → %', _ing.name, _fruit;
    ELSE
      -- Conflict: merge _ing ke _cid
      FOR _r IN SELECT * FROM recipes WHERE ingredient_id = _ing.id LOOP
        IF EXISTS (SELECT 1 FROM recipes WHERE menu_id = _r.menu_id AND ingredient_id = _cid) THEN
          UPDATE recipes SET qty = qty + _r.qty
          WHERE menu_id = _r.menu_id AND ingredient_id = _cid;
          DELETE FROM recipes WHERE id = _r.id;
        ELSE
          UPDATE recipes SET ingredient_id = _cid WHERE id = _r.id;
        END IF;
      END LOOP;
      UPDATE ingredient_vendors SET ingredient_id = _cid WHERE ingredient_id = _ing.id;
      DELETE FROM ingredients WHERE id = _ing.id;
      RAISE NOTICE '[garnish] Merged: % → % (%)', _ing.name, _fruit, _cid;
    END IF;
  END LOOP;
END $$;


-- ============================================================
-- BAGIAN 5: Fix typo nama menu bar
-- ============================================================
UPDATE menu_items SET name = 'Cappuccino'
  WHERE name ILIKE 'CAPPUCHINO' AND division = 'bar';

UPDATE menu_items SET name = 'Macchiato'
  WHERE name ILIKE 'MACCIATO' AND division = 'bar';

UPDATE menu_items SET name = 'Espresso Double'
  WHERE name ILIKE 'ESSPESSO DOUBLE' AND division = 'bar';

UPDATE menu_items SET name = 'Avocado Coffee'
  WHERE name ILIKE 'AVOCADO COFEE' AND division = 'bar';

UPDATE menu_items SET name = 'Butterscotch Latte'
  WHERE name ILIKE 'BUTTERSCHOTCH LATTE' AND division = 'bar';

UPDATE menu_items SET name = 'Berlaris Palm Sugar Latte'
  WHERE name ILIKE 'BERLARIS PALM SUGAR KATTE' AND division = 'bar';

UPDATE menu_items SET name = 'Chocolate Hazelnut'
  WHERE name ILIKE 'CHOCOLATE HAZELUT' AND division = 'bar';

UPDATE menu_items SET name = 'Mango Tea'
  WHERE name ILIKE 'MANGGO TEA' AND division = 'bar';

UPDATE menu_items SET name = 'Strawberry Tea'
  WHERE name ILIKE 'STRAWBERY TEA' AND division = 'bar';


-- ============================================================
-- BAGIAN 6: Insert 16 ingredient bar baru
--
-- Harga avg_cost_per_unit dihitung ke base_unit:
--   Gula Cair:          18.000/L   = 18.00/ml
--   Susu Tujuh Kurma:   10.000/kal = 10000.00/kal
--   Yakult:             15.000/5btl= 3000.00/btl
--   Sirup Marjan:       28.500/360ml= 79.17/ml
--   Sirup Tamarind:     50.000/640ml≈78.13/ml  (640g≈640ml liquid)
--   Tamarind Concentrate:30.000/275ml=109.09/ml
--   Rempah Uwuh:        3.000/pcs  = 3000.00/pcs
--   Kurma Buah:         25.000/250g= 100.00/g
--   Susu Evaporasi:     17.000/380g= 44.74/g
--   Kolang Kaling:      27.000/kg  = 27.00/g
--   Sagu Mutiara:       30.000/200g= 150.00/g
--   Jelly Cincau:        7.500/200g= 37.50/g
--   Tape:               13.000/kg  = 13.00/g
--   Nangka:             48.000/kg  = 48.00/g
--   Palm Sugar:         28.000/500g= 56.00/g
--   Buah Campuran:      80.000/kg  = 80.00/g
--
-- Semua INSERT hanya jika nama belum ada (ON CONFLICT DO NOTHING tidak bisa
-- dipakai karena ingredients.name tidak punya UNIQUE constraint).
-- Digunakan DO block + NOT EXISTS check.
-- ============================================================
DO $$
DECLARE
  _ml_id    UUID := (SELECT id FROM units WHERE name = 'ml');
  _g_id     UUID := (SELECT id FROM units WHERE name = 'gram');
  _btl_id   UUID := (SELECT id FROM units WHERE name = 'botol');
  _kal_id   UUID := (SELECT id FROM units WHERE name = 'kaleng');
  _pcs_id   UUID := (SELECT id FROM units WHERE name = 'pcs');
BEGIN

  -- 1. Gula Cair (processed — dibuat dari Gula Pasir)
  IF NOT EXISTS (SELECT 1 FROM ingredients WHERE LOWER(name) = 'gula cair') THEN
    INSERT INTO ingredients
      (name, ingredient_type, division, base_unit_id, avg_cost_per_unit, notes)
    VALUES
      ('Gula Cair', 'processed', 'bar', _ml_id, 18.00,
       '1L gula pasir (Rp 18.000/L) dilarutkan dengan air. Production chain: Gula Pasir → Gula Cair.');
    RAISE NOTICE '[insert] Gula Cair';
  END IF;

  -- 2. Susu Tujuh Kurma
  IF NOT EXISTS (SELECT 1 FROM ingredients WHERE LOWER(name) = 'susu tujuh kurma') THEN
    INSERT INTO ingredients
      (name, ingredient_type, division, base_unit_id, avg_cost_per_unit, notes)
    VALUES
      ('Susu Tujuh Kurma', 'raw', 'bar', _kal_id, 10000.00,
       'Susu kaleng kurma. Dipakai untuk Kopi Susu Kurma. Rp 10.000/kaleng.');
    RAISE NOTICE '[insert] Susu Tujuh Kurma';
  END IF;

  -- 3. Yakult
  IF NOT EXISTS (SELECT 1 FROM ingredients WHERE LOWER(name) = 'yakult') THEN
    INSERT INTO ingredients
      (name, ingredient_type, division, base_unit_id, avg_cost_per_unit, notes)
    VALUES
      ('Yakult', 'raw', 'bar', _btl_id, 3000.00,
       'Rp 15.000/5 botol = Rp 3.000/botol. Dipakai untuk Refreshing Cocofruit.');
    RAISE NOTICE '[insert] Yakult';
  END IF;

  -- 4. Sirup Marjan Cocopandan
  IF NOT EXISTS (SELECT 1 FROM ingredients WHERE LOWER(name) = 'sirup marjan cocopandan') THEN
    INSERT INTO ingredients
      (name, ingredient_type, division, base_unit_id, avg_cost_per_unit, notes)
    VALUES
      ('Sirup Marjan Cocopandan', 'raw', 'bar', _ml_id, 79.17,
       'Rp 28.500/360ml = Rp 79.17/ml. Dipakai untuk Es Campur Berlaris.');
    RAISE NOTICE '[insert] Sirup Marjan Cocopandan';
  END IF;

  -- 5. Sirup Tamarind
  IF NOT EXISTS (SELECT 1 FROM ingredients WHERE LOWER(name) = 'sirup tamarind') THEN
    INSERT INTO ingredients
      (name, ingredient_type, division, base_unit_id, avg_cost_per_unit, notes)
    VALUES
      ('Sirup Tamarind', 'raw', 'bar', _ml_id, 78.13,
       'Rp 50.000/640g ≈ 640ml (liquid). Rp 78.13/ml. Dipakai untuk Tamarind Ice Tea.');
    RAISE NOTICE '[insert] Sirup Tamarind';
  END IF;

  -- 6. Tamarind Concentrate (dari "Tamarind 3 Teko" — beli dalam botol 275ml)
  IF NOT EXISTS (SELECT 1 FROM ingredients WHERE LOWER(name) = 'tamarind concentrate') THEN
    INSERT INTO ingredients
      (name, ingredient_type, division, base_unit_id, avg_cost_per_unit, notes)
    VALUES
      ('Tamarind Concentrate', 'raw', 'bar', _ml_id, 109.09,
       'Rp 30.000/275ml = Rp 109.09/ml. Dijual dalam botol 275ml. Vendor belum diketahui — tanyakan admin.');
    RAISE NOTICE '[insert] Tamarind Concentrate';
  END IF;

  -- 7. Rempah Uwuh
  IF NOT EXISTS (SELECT 1 FROM ingredients WHERE LOWER(name) = 'rempah uwuh') THEN
    INSERT INTO ingredients
      (name, ingredient_type, division, base_unit_id, avg_cost_per_unit, notes)
    VALUES
      ('Rempah Uwuh', 'raw', 'bar', _pcs_id, 3000.00,
       'Paket rempah untuk Wedang Uwuh. Rp 3.000/pcs (paket).');
    RAISE NOTICE '[insert] Rempah Uwuh';
  END IF;

  -- 8. Kurma Buah
  IF NOT EXISTS (SELECT 1 FROM ingredients WHERE LOWER(name) = 'kurma buah') THEN
    INSERT INTO ingredients
      (name, ingredient_type, division, base_unit_id, avg_cost_per_unit, notes)
    VALUES
      ('Kurma Buah', 'raw', 'bar', _g_id, 100.00,
       'Rp 25.000/250g = Rp 100.00/g. Untuk Kopi Susu Kurma & Wedang Kurma.');
    RAISE NOTICE '[insert] Kurma Buah';
  END IF;

  -- 9. Susu Evaporasi
  IF NOT EXISTS (SELECT 1 FROM ingredients WHERE LOWER(name) = 'susu evaporasi') THEN
    INSERT INTO ingredients
      (name, ingredient_type, division, base_unit_id, avg_cost_per_unit, notes)
    VALUES
      ('Susu Evaporasi', 'raw', 'bar', _g_id, 44.74,
       'Rp 17.000/380g = Rp 44.74/g. Dipakai untuk Thai Tea.');
    RAISE NOTICE '[insert] Susu Evaporasi';
  END IF;

  -- 10. Kolang Kaling
  IF NOT EXISTS (SELECT 1 FROM ingredients WHERE LOWER(name) = 'kolang kaling') THEN
    INSERT INTO ingredients
      (name, ingredient_type, division, base_unit_id, avg_cost_per_unit, notes)
    VALUES
      ('Kolang Kaling', 'raw', 'bar', _g_id, 27.00,
       'Rp 27.000/kg = Rp 27.00/g. Untuk Es Campur Berlaris.');
    RAISE NOTICE '[insert] Kolang Kaling';
  END IF;

  -- 11. Sagu Mutiara
  IF NOT EXISTS (SELECT 1 FROM ingredients WHERE LOWER(name) = 'sagu mutiara') THEN
    INSERT INTO ingredients
      (name, ingredient_type, division, base_unit_id, avg_cost_per_unit, notes)
    VALUES
      ('Sagu Mutiara', 'raw', 'bar', _g_id, 150.00,
       'Rp 30.000/200g = Rp 150.00/g. Untuk Es Campur Berlaris.');
    RAISE NOTICE '[insert] Sagu Mutiara';
  END IF;

  -- 12. Jelly Cincau
  IF NOT EXISTS (SELECT 1 FROM ingredients WHERE LOWER(name) = 'jelly cincau') THEN
    INSERT INTO ingredients
      (name, ingredient_type, division, base_unit_id, avg_cost_per_unit, notes)
    VALUES
      ('Jelly Cincau', 'raw', 'bar', _g_id, 37.50,
       'Rp 7.500/200g = Rp 37.50/g. Untuk Es Campur Berlaris.');
    RAISE NOTICE '[insert] Jelly Cincau';
  END IF;

  -- 13. Tape
  IF NOT EXISTS (SELECT 1 FROM ingredients WHERE LOWER(name) = 'tape') THEN
    INSERT INTO ingredients
      (name, ingredient_type, division, base_unit_id, avg_cost_per_unit, notes)
    VALUES
      ('Tape', 'raw', 'bar', _g_id, 13.00,
       'Rp 13.000/kg = Rp 13.00/g. Untuk Es Campur Berlaris.');
    RAISE NOTICE '[insert] Tape';
  END IF;

  -- 14. Nangka
  IF NOT EXISTS (SELECT 1 FROM ingredients WHERE LOWER(name) = 'nangka') THEN
    INSERT INTO ingredients
      (name, ingredient_type, division, base_unit_id, avg_cost_per_unit, notes)
    VALUES
      ('Nangka', 'raw', 'bar', _g_id, 48.00,
       'Rp 48.000/kg = Rp 48.00/g. Untuk Es Campur Berlaris.');
    RAISE NOTICE '[insert] Nangka';
  END IF;

  -- 15. Palm Sugar
  --     ⚠ PERHATIAN: Cek apakah ini sama dengan "Gula Aren" yang mungkin sudah ada.
  --     Kalau ada "Gula Aren" di bar ingredients → jalankan query merge manual setelah konfirmasi.
  IF NOT EXISTS (SELECT 1 FROM ingredients WHERE LOWER(name) IN ('palm sugar', 'gula aren')) THEN
    INSERT INTO ingredients
      (name, ingredient_type, division, base_unit_id, avg_cost_per_unit, notes)
    VALUES
      ('Palm Sugar', 'raw', 'bar', _g_id, 56.00,
       'Rp 28.000/500g = Rp 56.00/g. ⚠ Konfirmasi: sama dengan Gula Aren di bar? Kalau iya, merge manual.');
    RAISE NOTICE '[insert] Palm Sugar (belum konfirmasi apakah = Gula Aren)';
  ELSE
    RAISE NOTICE '[skip] Palm Sugar — sudah ada "Palm Sugar" atau "Gula Aren" di DB';
  END IF;

  -- 16. Buah Campuran
  --     Menggantikan "3 Mix Fruit" yang diabaikan. Dipakai di BOM Mix Juice.
  IF NOT EXISTS (SELECT 1 FROM ingredients WHERE LOWER(name) = 'buah campuran') THEN
    INSERT INTO ingredients
      (name, ingredient_type, division, base_unit_id, avg_cost_per_unit, notes)
    VALUES
      ('Buah Campuran', 'raw', 'bar', _g_id, 80.00,
       'Harga estimasi Rp 80.000/kg = Rp 80.00/g. Pengganti "3 Mix Fruit" untuk BOM Mix Juice. '
       'Bisa diganti dengan buah individual (Melon, Semangka, Alpukat) di BOM bila data tersedia.');
    RAISE NOTICE '[insert] Buah Campuran';
  END IF;

END $$;


-- ============================================================
-- BAGIAN 7: Production process — Gula Pasir → Gula Cair
--
-- 1 stage: "Melarutkan", yield_pct = 100
-- (1 kg gula pasir → ~1 liter gula cair, zero loss)
-- ============================================================
DO $$
DECLARE
  _raw_id    UUID;  -- Gula Pasir
  _output_id UUID;  -- Gula Cair
  _proc_id   UUID;  -- production_process id
BEGIN
  -- Ambil Gula Pasir (raw ingredient, bisa di bar atau both)
  SELECT id INTO _raw_id
  FROM ingredients
  WHERE LOWER(name) IN ('gula pasir', 'sugar', 'gula')
    AND ingredient_type = 'raw'
  ORDER BY
    CASE LOWER(name)
      WHEN 'gula pasir' THEN 1
      WHEN 'gula'       THEN 2
      ELSE 3
    END
  LIMIT 1;

  IF _raw_id IS NULL THEN
    RAISE WARNING '[gula_cair_process] Gula Pasir tidak ditemukan di ingredients! '
                  'Insert manual Gula Pasir terlebih dahulu, lalu jalankan bagian ini lagi.';
    RETURN;
  END IF;

  -- Ambil Gula Cair (baru di-insert di BAGIAN 6)
  SELECT id INTO _output_id
  FROM ingredients
  WHERE LOWER(name) = 'gula cair'
  LIMIT 1;

  IF _output_id IS NULL THEN
    RAISE WARNING '[gula_cair_process] Gula Cair tidak ditemukan! Pastikan BAGIAN 6 sudah jalan.';
    RETURN;
  END IF;

  -- Cek apakah production_process sudah ada
  SELECT id INTO _proc_id
  FROM production_processes
  WHERE raw_ingredient_id = _raw_id
    AND output_ingredient_id = _output_id
  LIMIT 1;

  IF _proc_id IS NOT NULL THEN
    RAISE NOTICE '[gula_cair_process] Production process sudah ada (id: %)', _proc_id;
    RETURN;
  END IF;

  -- Insert production_process
  INSERT INTO production_processes
    (name, raw_ingredient_id, output_ingredient_id, is_active, notes)
  VALUES
    ('Pembuatan Gula Cair', _raw_id, _output_id, true,
     '1 kg Gula Pasir dilarutkan dengan air panas → ~1 liter Gula Cair (yield 100%)')
  RETURNING id INTO _proc_id;

  -- Insert 1 production_stage: Melarutkan, yield 100%
  INSERT INTO production_stages
    (process_id, stage_order, stage_name, yield_pct, notes)
  VALUES
    (_proc_id, 1, 'Melarutkan', 100.00,
     '1 kg gula pasir + air panas → 1 liter gula cair. Yield dianggap 100% (no volume loss).');

  RAISE NOTICE '[gula_cair_process] Created production process id: %', _proc_id;
END $$;


-- ============================================================
-- BAGIAN 8: Unit conversion baru
-- ============================================================
-- kaleng Susu Tujuh Kurma tidak perlu konversi ke ml (dipake as-is per kaleng)
-- Sirup dalam ml sudah langsung cocok dengan BOM bar

-- Yakult: 1 botol = 65ml (kalau BOM butuh konversi)
INSERT INTO unit_conversions (from_unit_id, to_unit_id, factor, notes)
SELECT f.id, t.id, 65, '1 botol Yakult ≈ 65ml'
FROM units f, units t
WHERE f.name = 'botol' AND t.name = 'ml'
ON CONFLICT (from_unit_id, to_unit_id) DO NOTHING;

-- kaleng: 1 kaleng Susu Tujuh Kurma ≈ 390ml (standar kaleng susu ~390g/ml)
INSERT INTO unit_conversions (from_unit_id, to_unit_id, factor, notes)
SELECT f.id, t.id, 390, '1 kaleng standar ≈ 390ml'
FROM units f, units t
WHERE f.name = 'kaleng' AND t.name = 'ml'
ON CONFLICT (from_unit_id, to_unit_id) DO NOTHING;


-- ============================================================
-- BAGIAN 9: Fix harga Air (koreksi dari Rp 19.000 → Rp 21.000/galon 18L)
-- Rp 21.000/18L = Rp 1.167/L = Rp 1.167/liter
-- Base unit air = liter → avg_cost_per_unit = 1167 (Rp/liter)
-- Kalau base unit = ml → avg_cost_per_unit = 1.167 (Rp/ml)
-- ============================================================
-- Cek nama yang dipakai untuk air di DB:
-- UPDATE ingredients SET avg_cost_per_unit = 1.167
--   WHERE LOWER(name) IN ('air', 'air mineral', 'air galon')
--     AND division IN ('bar', 'both');
-- ← Uncomment baris di atas setelah konfirmasi nama ingredient Air di DB.


-- ============================================================
-- BAGIAN 10: Cleanup function sementara
-- ============================================================
DROP FUNCTION IF EXISTS _berlaris_merge_ingredient(TEXT, TEXT[]);


-- ============================================================
-- VERIFIKASI: Tampilkan hasilnya
-- ============================================================
SELECT
  name,
  ingredient_type,
  division,
  (SELECT symbol FROM units WHERE id = base_unit_id) AS base_unit,
  avg_cost_per_unit,
  notes
FROM ingredients
WHERE name IN (
  'Fresh Milk','Coffee Beans Houseblend','Whipping Cream','Nata De Coco',
  'Sirup Lychee','Sirup Blue Curacao','Es Krim Vanilla','Chocolate Powder',
  'Susu Kental Manis',
  'Gula Cair','Susu Tujuh Kurma','Yakult','Sirup Marjan Cocopandan',
  'Sirup Tamarind','Tamarind Concentrate','Rempah Uwuh','Kurma Buah',
  'Susu Evaporasi','Kolang Kaling','Sagu Mutiara','Jelly Cincau',
  'Tape','Nangka','Palm Sugar','Buah Campuran'
)
ORDER BY division, name;

COMMIT;

-- ============================================================
-- CATATAN PASCA-EKSEKUSI
-- ============================================================
-- 1. Cek NOTICE output untuk ingredient yang di-merge atau di-skip.
-- 2. Verifikasi query SELECT terakhir — semua 25 baris harus muncul.
-- 3. Palm Sugar: kalau "Gula Aren" sudah ada di DB, jalankan:
--    SELECT _berlaris_merge_ingredient('Gula Aren', ARRAY['Palm Sugar']);
--    (atau sebaliknya, tergantung nama yang mau dipakai)
-- 4. Air: uncomment UPDATE di BAGIAN 9 setelah tahu nama exact-nya di DB.
-- 5. Gula Pasir: kalau WARNING muncul "tidak ditemukan", tambahkan dulu:
--    INSERT INTO ingredients (name, ingredient_type, division, base_unit_id, avg_cost_per_unit)
--    VALUES ('Gula Pasir', 'raw', 'bar', (SELECT id FROM units WHERE name='kilogram'), 18000);
--    Lalu jalankan ulang BAGIAN 7.
-- 6. Tamarind Concentrate: vendor belum diketahui. Tanyakan admin.
-- ============================================================
