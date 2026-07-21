-- ============================================================
-- SEED: ingredients
-- Berlaris Kopi & Resto — Bar (83) + Kitchen (76+6) items
-- Run di Supabase SQL Editor
-- ============================================================

-- Unit UUID references (dari tabel units yang sudah ada):
-- gram     : 90222804-fe6a-4b4d-b8a2-37149ecbfa23
-- kilogram : 95a26ace-1230-4ecf-af40-345588a5621c
-- ml       : d32d1ed2-7b7d-484e-9471-98fa5754c8f0
-- liter    : 72f5af4b-8085-4ceb-b653-c35d9e348df2
-- pcs      : c1eaae22-0bd7-4ac4-97df-90778e7cff1a
-- porsi    : a37de0d2-ab0c-4816-a2b2-78ab89d092ea
-- botol    : 7ff513ce-116b-4828-8fce-1d9da58f2e0e
-- galon    : 42e5f9f6-9190-4f58-8726-975c88c4d981
-- pack     : 9762c2fb-2693-42aa-a1ec-e369ea173b90
-- buah     : 6d692105-1f20-46a2-80db-cb55223c9659
-- lembar   : 1a950b9b-1d29-4af9-bbee-d62bdfd2b039
-- sachet   : dbc921bb-042f-4780-9b9d-a1c3db812e61
-- jerigen  : 7fe71bc3-f6d1-4f94-9e9a-cb3a259eb393
-- ekor     : ab504fb2-06f5-4103-b1e5-ace4093b5642
-- pax      : 9559d947-8fb0-4740-957b-c2ef41102062

INSERT INTO ingredients (name, ingredient_type, division, base_unit_id, avg_cost_per_unit, portion_size_g, notes) VALUES

-- ============================================================
-- BAR — RAW (bahan baku bar)
-- ============================================================

-- Kopi & Espresso Base
('Espresso Beans Robusta', 'raw', 'bar', '90222804-fe6a-4b4d-b8a2-37149ecbfa23', 120, NULL, 'Biji kopi robusta untuk espresso'),
('Espresso Beans Arabica', 'raw', 'bar', '90222804-fe6a-4b4d-b8a2-37149ecbfa23', 180, NULL, 'Biji kopi arabica single origin'),
('Cold Brew Concentrate', 'raw', 'bar', 'd32d1ed2-7b7d-484e-9471-98fa5754c8f0', 0, NULL, 'Dibuat in-house dari beans'),

-- Susu & Dairy
('Fresh Milk Full Cream', 'raw', 'bar', 'd32d1ed2-7b7d-484e-9471-98fa5754c8f0', 18, NULL, 'per ml'),
('Oat Milk', 'raw', 'bar', 'd32d1ed2-7b7d-484e-9471-98fa5754c8f0', 25, NULL, 'per ml'),
('Condensed Milk', 'raw', 'bar', 'd32d1ed2-7b7d-484e-9471-98fa5754c8f0', 20, NULL, 'Susu kental manis'),
('Heavy Cream', 'raw', 'bar', 'd32d1ed2-7b7d-484e-9471-98fa5754c8f0', 35, NULL, 'Krim kental untuk topping'),
('Whipped Cream', 'raw', 'bar', 'd32d1ed2-7b7d-484e-9471-98fa5754c8f0', 30, NULL, 'Whipped cream kaleng'),

-- Teh
('Teh Hijau / Matcha Powder', 'raw', 'bar', '90222804-fe6a-4b4d-b8a2-37149ecbfa23', 400, NULL, 'Matcha grade culinary'),
('Teh Hitam / Black Tea', 'raw', 'bar', '90222804-fe6a-4b4d-b8a2-37149ecbfa23', 150, NULL, 'Teh celup premium'),
('Teh Oolong', 'raw', 'bar', '90222804-fe6a-4b4d-b8a2-37149ecbfa23', 300, NULL, NULL),
('Teh Chamomile', 'raw', 'bar', '90222804-fe6a-4b4d-b8a2-37149ecbfa23', 350, NULL, NULL),
('Teh Peppermint', 'raw', 'bar', '90222804-fe6a-4b4d-b8a2-37149ecbfa23', 350, NULL, NULL),
('Lemon Tea Sachet', 'raw', 'bar', 'dbc921bb-042f-4780-9b9d-a1c3db812e61', 2000, NULL, 'per sachet'),

-- Sirup & Flavoring
('Sirup Vanila', 'raw', 'bar', 'd32d1ed2-7b7d-484e-9471-98fa5754c8f0', 120, NULL, 'Monin / Torani per ml'),
('Sirup Hazelnut', 'raw', 'bar', 'd32d1ed2-7b7d-484e-9471-98fa5754c8f0', 120, NULL, NULL),
('Sirup Caramel', 'raw', 'bar', 'd32d1ed2-7b7d-484e-9471-98fa5754c8f0', 100, NULL, NULL),
('Sirup Taro', 'raw', 'bar', 'd32d1ed2-7b7d-484e-9471-98fa5754c8f0', 110, NULL, NULL),
('Sirup Lychee', 'raw', 'bar', 'd32d1ed2-7b7d-484e-9471-98fa5754c8f0', 110, NULL, NULL),
('Sirup Strawberry', 'raw', 'bar', 'd32d1ed2-7b7d-484e-9471-98fa5754c8f0', 100, NULL, NULL),
('Sirup Cocopandan', 'raw', 'bar', 'd32d1ed2-7b7d-484e-9471-98fa5754c8f0', 80, NULL, NULL),
('Sirup Grenadine', 'raw', 'bar', 'd32d1ed2-7b7d-484e-9471-98fa5754c8f0', 120, NULL, NULL),
('Sirup Gula Aren', 'raw', 'bar', 'd32d1ed2-7b7d-484e-9471-98fa5754c8f0', 90, NULL, 'Brown sugar syrup'),
('Sirup Rose', 'raw', 'bar', 'd32d1ed2-7b7d-484e-9471-98fa5754c8f0', 100, NULL, NULL),
('Sirup Pandan', 'raw', 'bar', 'd32d1ed2-7b7d-484e-9471-98fa5754c8f0', 80, NULL, NULL),
('Simple Syrup', 'raw', 'bar', 'd32d1ed2-7b7d-484e-9471-98fa5754c8f0', 30, NULL, 'Dibuat in-house gula+air 1:1'),
('Mango Puree', 'raw', 'bar', 'd32d1ed2-7b7d-484e-9471-98fa5754c8f0', 80, NULL, NULL),
('Passion Fruit Puree', 'raw', 'bar', 'd32d1ed2-7b7d-484e-9471-98fa5754c8f0', 120, NULL, NULL),

-- Buah Segar
('Lemon Segar', 'raw', 'bar', '6d692105-1f20-46a2-80db-cb55223c9659', 3000, NULL, 'per buah'),
('Jeruk Nipis', 'raw', 'bar', '6d692105-1f20-46a2-80db-cb55223c9659', 1500, NULL, 'per buah'),
('Stroberi Segar', 'raw', 'bar', '90222804-fe6a-4b4d-b8a2-37149ecbfa23', 80, NULL, 'per gram'),
('Mangga Segar', 'raw', 'bar', '90222804-fe6a-4b4d-b8a2-37149ecbfa23', 25, NULL, 'per gram'),
('Pisang', 'raw', 'bar', '6d692105-1f20-46a2-80db-cb55223c9659', 3000, NULL, 'per buah'),
('Alpukat', 'raw', 'bar', '6d692105-1f20-46a2-80db-cb55223c9659', 8000, NULL, 'per buah'),
('Semangka', 'raw', 'bar', '90222804-fe6a-4b4d-b8a2-37149ecbfa23', 8, NULL, 'per gram'),

-- Coklat & Powder
('Coklat Bubuk / Cocoa Powder', 'raw', 'bar', '90222804-fe6a-4b4d-b8a2-37149ecbfa23', 80, NULL, 'per gram'),
('Dark Chocolate Sauce', 'raw', 'bar', 'd32d1ed2-7b7d-484e-9471-98fa5754c8f0', 120, NULL, 'per ml, Hershey/Monin'),
('White Chocolate Sauce', 'raw', 'bar', 'd32d1ed2-7b7d-484e-9471-98fa5754c8f0', 130, NULL, NULL),
('Chocolate Powder (Milo)', 'raw', 'bar', '90222804-fe6a-4b4d-b8a2-37149ecbfa23', 45, NULL, 'per gram'),
('Ovaltine Powder', 'raw', 'bar', '90222804-fe6a-4b4d-b8a2-37149ecbfa23', 50, NULL, 'per gram'),

-- Bahan Minuman Lain
('Gula Pasir', 'raw', 'bar', '90222804-fe6a-4b4d-b8a2-37149ecbfa23', 15, NULL, 'per gram'),
('Gula Merah / Palm Sugar', 'raw', 'bar', '90222804-fe6a-4b4d-b8a2-37149ecbfa23', 20, NULL, 'per gram'),
('Madu', 'raw', 'bar', 'd32d1ed2-7b7d-484e-9471-98fa5754c8f0', 80, NULL, 'per ml'),
('Es Batu', 'raw', 'bar', '90222804-fe6a-4b4d-b8a2-37149ecbfa23', 2, NULL, 'per gram / es kristal'),
('Air Mineral', 'raw', 'bar', 'd32d1ed2-7b7d-484e-9471-98fa5754c8f0', 3, NULL, 'per ml'),
('Soda Water', 'raw', 'bar', 'd32d1ed2-7b7d-484e-9471-98fa5754c8f0', 8, NULL, 'per ml'),
('Tonic Water', 'raw', 'bar', 'd32d1ed2-7b7d-484e-9471-98fa5754c8f0', 10, NULL, 'per ml'),
('Coconut Water', 'raw', 'bar', 'd32d1ed2-7b7d-484e-9471-98fa5754c8f0', 15, NULL, 'per ml'),
('Coconut Milk (Santan)', 'raw', 'bar', 'd32d1ed2-7b7d-484e-9471-98fa5754c8f0', 25, NULL, 'per ml'),
('Jelly / Nata de Coco', 'raw', 'bar', '90222804-fe6a-4b4d-b8a2-37149ecbfa23', 30, NULL, 'per gram'),
('Cincau Hitam', 'raw', 'bar', '90222804-fe6a-4b4d-b8a2-37149ecbfa23', 25, NULL, 'per gram'),
('Chia Seeds', 'raw', 'bar', '90222804-fe6a-4b4d-b8a2-37149ecbfa23', 60, NULL, 'per gram'),
('Boba Tapioka', 'raw', 'bar', '90222804-fe6a-4b4d-b8a2-37149ecbfa23', 20, NULL, 'per gram, uncooked'),
('Garam (bar)', 'raw', 'bar', '90222804-fe6a-4b4d-b8a2-37149ecbfa23', 5, NULL, 'per gram, untuk rim gelas'),
('Vanilla Extract', 'raw', 'bar', 'd32d1ed2-7b7d-484e-9471-98fa5754c8f0', 200, NULL, 'per ml'),
('Blue Curacao Syrup', 'raw', 'bar', 'd32d1ed2-7b7d-484e-9471-98fa5754c8f0', 110, NULL, NULL),
('Peach Syrup', 'raw', 'bar', 'd32d1ed2-7b7d-484e-9471-98fa5754c8f0', 110, NULL, NULL),
('Pineapple Juice', 'raw', 'bar', 'd32d1ed2-7b7d-484e-9471-98fa5754c8f0', 20, NULL, 'per ml'),
('Orange Juice', 'raw', 'bar', 'd32d1ed2-7b7d-484e-9471-98fa5754c8f0', 25, NULL, 'per ml'),

-- BAR — PACKAGING
('Hot Cup 8oz', 'packaging', 'bar', 'c1eaae22-0bd7-4ac4-97df-90778e7cff1a', 800, NULL, NULL),
('Hot Cup 12oz', 'packaging', 'bar', 'c1eaae22-0bd7-4ac4-97df-90778e7cff1a', 900, NULL, NULL),
('Cold Cup 16oz', 'packaging', 'bar', 'c1eaae22-0bd7-4ac4-97df-90778e7cff1a', 700, NULL, NULL),
('Cold Cup 22oz', 'packaging', 'bar', 'c1eaae22-0bd7-4ac4-97df-90778e7cff1a', 900, NULL, NULL),
('Lid Hot Cup', 'packaging', 'bar', 'c1eaae22-0bd7-4ac4-97df-90778e7cff1a', 300, NULL, NULL),
('Lid Cold Cup', 'packaging', 'bar', 'c1eaae22-0bd7-4ac4-97df-90778e7cff1a', 300, NULL, NULL),
('Sedotan Plastik', 'packaging', 'bar', 'c1eaae22-0bd7-4ac4-97df-90778e7cff1a', 100, NULL, NULL),
('Sedotan Kertas', 'packaging', 'bar', 'c1eaae22-0bd7-4ac4-97df-90778e7cff1a', 200, NULL, NULL),
('Sleeve / Sleeve Cup', 'packaging', 'bar', 'c1eaae22-0bd7-4ac4-97df-90778e7cff1a', 250, NULL, NULL),
('Kantong Plastik Kecil', 'packaging', 'bar', 'c1eaae22-0bd7-4ac4-97df-90778e7cff1a', 200, NULL, NULL),
('Tisu', 'packaging', 'both', 'c1eaae22-0bd7-4ac4-97df-90778e7cff1a', 100, NULL, 'per lembar'),

-- ============================================================
-- KITCHEN — RAW (bahan baku dapur)
-- ============================================================

-- Protein Utama (raw — masuk 11 production chains)
('Buntut Sapi', 'raw', 'kitchen', '90222804-fe6a-4b4d-b8a2-37149ecbfa23', 110, NULL, 'per gram, beli per kg'),
('Iga Sapi', 'raw', 'kitchen', '90222804-fe6a-4b4d-b8a2-37149ecbfa23', 120, NULL, 'per gram'),
('Daging Sapi Giling', 'raw', 'kitchen', '90222804-fe6a-4b4d-b8a2-37149ecbfa23', 95, NULL, 'per gram, untuk patty & bolognaise'),
('Daging Sapi Iris', 'raw', 'kitchen', '90222804-fe6a-4b4d-b8a2-37149ecbfa23', 100, NULL, 'per gram, untuk soto & sate'),
('Ayam Utuh', 'raw', 'kitchen', '90222804-fe6a-4b4d-b8a2-37149ecbfa23', 35, NULL, 'per gram, ~1kg/ekor'),
('Dada Fillet Ayam', 'raw', 'kitchen', '90222804-fe6a-4b4d-b8a2-37149ecbfa23', 48, NULL, 'per gram, Rp 48.000/kg'),
('Paha Ayam', 'raw', 'kitchen', '90222804-fe6a-4b4d-b8a2-37149ecbfa23', 40, NULL, 'per gram'),
('Sayap Ayam', 'raw', 'kitchen', '90222804-fe6a-4b4d-b8a2-37149ecbfa23', 35, NULL, 'per gram, untuk Korean wing'),
('Daging Kambing Utuh', 'raw', 'kitchen', '90222804-fe6a-4b4d-b8a2-37149ecbfa23', 90, NULL, 'per gram'),
('Bebek Hibrida', 'raw', 'kitchen', 'ab504fb2-06f5-4103-b1e5-ace4093b5642', 55000, NULL, 'per ekor ~1.2kg, Rp 55.000/ekor'),
('Smoked Beef Utuh', 'raw', 'kitchen', '90222804-fe6a-4b4d-b8a2-37149ecbfa23', 85, NULL, 'per gram'),
('Udang Vaname Kupas', 'raw', 'kitchen', '90222804-fe6a-4b4d-b8a2-37149ecbfa23', 90, NULL, 'per gram, Rp 90.000/kg'),
('Ikan Dori Fillet', 'raw', 'kitchen', '90222804-fe6a-4b4d-b8a2-37149ecbfa23', 55, NULL, 'per gram'),
('Cumi-cumi', 'raw', 'kitchen', '90222804-fe6a-4b4d-b8a2-37149ecbfa23', 74, NULL, 'per gram, Rp 74.000/kg'),
('Telur Ayam', 'raw', 'kitchen', '90222804-fe6a-4b4d-b8a2-37149ecbfa23', 26, NULL, 'per gram, Rp 25.000–26.000/kg'),
('Telur Puyuh', 'raw', 'kitchen', 'c1eaae22-0bd7-4ac4-97df-90778e7cff1a', 500, NULL, 'per butir'),

-- Sayuran & Bumbu Segar
('Bawang Merah', 'raw', 'kitchen', '90222804-fe6a-4b4d-b8a2-37149ecbfa23', 25, NULL, 'per gram'),
('Bawang Putih', 'raw', 'kitchen', '90222804-fe6a-4b4d-b8a2-37149ecbfa23', 30, NULL, 'per gram'),
('Bawang Bombay', 'raw', 'kitchen', '90222804-fe6a-4b4d-b8a2-37149ecbfa23', 20, NULL, 'per gram'),
('Tomat Segar', 'raw', 'kitchen', '90222804-fe6a-4b4d-b8a2-37149ecbfa23', 12, NULL, 'per gram'),
('Cabai Merah', 'raw', 'kitchen', '90222804-fe6a-4b4d-b8a2-37149ecbfa23', 40, NULL, 'per gram'),
('Cabai Rawit', 'raw', 'kitchen', '90222804-fe6a-4b4d-b8a2-37149ecbfa23', 50, NULL, 'per gram'),
('Jahe', 'raw', 'kitchen', '90222804-fe6a-4b4d-b8a2-37149ecbfa23', 20, NULL, 'per gram'),
('Lengkuas', 'raw', 'kitchen', '90222804-fe6a-4b4d-b8a2-37149ecbfa23', 15, NULL, 'per gram'),
('Serai', 'raw', 'kitchen', '90222804-fe6a-4b4d-b8a2-37149ecbfa23', 10, NULL, 'per gram'),
('Daun Salam', 'raw', 'kitchen', 'c1eaae22-0bd7-4ac4-97df-90778e7cff1a', 200, NULL, 'per lembar'),
('Daun Jeruk', 'raw', 'kitchen', 'c1eaae22-0bd7-4ac4-97df-90778e7cff1a', 100, NULL, 'per lembar'),
('Daun Kemangi', 'raw', 'kitchen', '90222804-fe6a-4b4d-b8a2-37149ecbfa23', 20, NULL, 'per gram'),
('Daun Bawang', 'raw', 'kitchen', '90222804-fe6a-4b4d-b8a2-37149ecbfa23', 15, NULL, 'per gram'),
('Seledri', 'raw', 'kitchen', '90222804-fe6a-4b4d-b8a2-37149ecbfa23', 15, NULL, 'per gram'),
('Wortel', 'raw', 'kitchen', '90222804-fe6a-4b4d-b8a2-37149ecbfa23', 12, NULL, 'per gram'),
('Kentang', 'raw', 'kitchen', '90222804-fe6a-4b4d-b8a2-37149ecbfa23', 15, NULL, 'per gram'),
('Singkong Mentah', 'raw', 'kitchen', '90222804-fe6a-4b4d-b8a2-37149ecbfa23', 8, NULL, 'per gram, Rp 8.000/kg'),
('Jamur Kancing', 'raw', 'kitchen', '90222804-fe6a-4b4d-b8a2-37149ecbfa23', 30, NULL, 'per gram'),
('Jamur Tiram', 'raw', 'kitchen', '90222804-fe6a-4b4d-b8a2-37149ecbfa23', 25, NULL, 'per gram'),
('Lettuce / Selada', 'raw', 'kitchen', '90222804-fe6a-4b4d-b8a2-37149ecbfa23', 20, NULL, 'per gram'),
('Kubis / Kol', 'raw', 'kitchen', '90222804-fe6a-4b4d-b8a2-37149ecbfa23', 10, NULL, 'per gram'),
('Timun', 'raw', 'kitchen', '90222804-fe6a-4b4d-b8a2-37149ecbfa23', 8, NULL, 'per gram'),
('Tomat Cherry', 'raw', 'kitchen', '90222804-fe6a-4b4d-b8a2-37149ecbfa23', 40, NULL, 'per gram'),

-- Karbohidrat & Tepung
('Beras Cap Jambu', 'raw', 'kitchen', '90222804-fe6a-4b4d-b8a2-37149ecbfa23', 16, NULL, 'per gram, Rp 16.250/kg dari 20kg bag'),
('Tepung Terigu', 'raw', 'kitchen', '90222804-fe6a-4b4d-b8a2-37149ecbfa23', 12, NULL, 'per gram'),
('Tepung Roti / Breadcrumb', 'raw', 'kitchen', '90222804-fe6a-4b4d-b8a2-37149ecbfa23', 20, NULL, 'per gram'),
('Tepung Maizena', 'raw', 'kitchen', '90222804-fe6a-4b4d-b8a2-37149ecbfa23', 15, NULL, 'per gram'),
('Tepung Tapioka', 'raw', 'kitchen', '90222804-fe6a-4b4d-b8a2-37149ecbfa23', 12, NULL, 'per gram'),
('Spaghetti / Pasta', 'raw', 'kitchen', '90222804-fe6a-4b4d-b8a2-37149ecbfa23', 18, NULL, 'per gram'),
('Roti Burger Bun', 'raw', 'kitchen', 'c1eaae22-0bd7-4ac4-97df-90778e7cff1a', 4000, NULL, 'per pcs'),
('Roti Slider Bun', 'raw', 'kitchen', 'c1eaae22-0bd7-4ac4-97df-90778e7cff1a', 2500, NULL, 'per pcs'),
('Kulit Springroll', 'raw', 'kitchen', '1a950b9b-1d29-4af9-bbee-d62bdfd2b039', 800, NULL, 'per lembar, untuk springroll & risol'),
('Kulit Corn Tortila Utuh', 'raw', 'kitchen', 'c1eaae22-0bd7-4ac4-97df-90778e7cff1a', 5000, NULL, 'per buah utuh'),

-- Minyak & Lemak
('Minyak Goreng', 'raw', 'kitchen', 'd32d1ed2-7b7d-484e-9471-98fa5754c8f0', 24, NULL, 'per ml, Rp 435.900/18L'),
('Minyak Zaitun / Olive Oil', 'raw', 'kitchen', 'd32d1ed2-7b7d-484e-9471-98fa5754c8f0', 80, NULL, 'per ml'),
('Butter Unsalted', 'raw', 'kitchen', '90222804-fe6a-4b4d-b8a2-37149ecbfa23', 50, NULL, 'per gram'),
('Margarin', 'raw', 'kitchen', '90222804-fe6a-4b4d-b8a2-37149ecbfa23', 20, NULL, 'per gram'),

-- Bumbu Kering & Saus
('Garam Dapur', 'raw', 'kitchen', '90222804-fe6a-4b4d-b8a2-37149ecbfa23', 5, NULL, 'per gram'),
('Merica Bubuk', 'raw', 'kitchen', '90222804-fe6a-4b4d-b8a2-37149ecbfa23', 80, NULL, 'per gram'),
('Gula Pasir (kitchen)', 'raw', 'kitchen', '90222804-fe6a-4b4d-b8a2-37149ecbfa23', 15, NULL, 'per gram'),
('Kecap Manis', 'raw', 'kitchen', 'd32d1ed2-7b7d-484e-9471-98fa5754c8f0', 25, NULL, 'per ml'),
('Kecap Asin', 'raw', 'kitchen', 'd32d1ed2-7b7d-484e-9471-98fa5754c8f0', 20, NULL, 'per ml'),
('Saus Tiram', 'raw', 'kitchen', 'd32d1ed2-7b7d-484e-9471-98fa5754c8f0', 30, NULL, 'per ml'),
('Saus Tomat Botol', 'raw', 'kitchen', 'd32d1ed2-7b7d-484e-9471-98fa5754c8f0', 20, NULL, 'per ml'),
('Saus Sambal Botol', 'raw', 'kitchen', 'd32d1ed2-7b7d-484e-9471-98fa5754c8f0', 20, NULL, 'per ml'),
('Saus BBQ', 'raw', 'kitchen', 'd32d1ed2-7b7d-484e-9471-98fa5754c8f0', 35, NULL, 'per ml'),
('Mayones', 'raw', 'kitchen', 'd32d1ed2-7b7d-484e-9471-98fa5754c8f0', 30, NULL, 'per ml'),
('Knorr Chicken Powder', 'raw', 'kitchen', '90222804-fe6a-4b4d-b8a2-37149ecbfa23', 99, NULL, 'per gram, Rp 99.000/kg'),
('Saus Korea / Gochujang', 'raw', 'kitchen', '90222804-fe6a-4b4d-b8a2-37149ecbfa23', 60, NULL, 'per gram'),
('Kari Bubuk', 'raw', 'kitchen', '90222804-fe6a-4b4d-b8a2-37149ecbfa23', 50, NULL, 'per gram'),
('Paprika Bubuk', 'raw', 'kitchen', '90222804-fe6a-4b4d-b8a2-37149ecbfa23', 60, NULL, 'per gram'),
('Kunyit Bubuk', 'raw', 'kitchen', '90222804-fe6a-4b4d-b8a2-37149ecbfa23', 30, NULL, 'per gram'),
('Ketumbar Bubuk', 'raw', 'kitchen', '90222804-fe6a-4b4d-b8a2-37149ecbfa23', 35, NULL, 'per gram'),
('Jinten Bubuk', 'raw', 'kitchen', '90222804-fe6a-4b4d-b8a2-37149ecbfa23', 40, NULL, 'per gram'),
('Pasta Tomat / Tomato Paste', 'raw', 'kitchen', '90222804-fe6a-4b4d-b8a2-37149ecbfa23', 30, NULL, 'per gram'),
('Parmesan Keju', 'raw', 'kitchen', '90222804-fe6a-4b4d-b8a2-37149ecbfa23', 120, NULL, 'per gram'),
('Keju Cheddar Slice', 'raw', 'kitchen', 'c1eaae22-0bd7-4ac4-97df-90778e7cff1a', 3000, NULL, 'per slice'),
('Cream of Mushroom (kaleng)', 'raw', 'kitchen', '90222804-fe6a-4b4d-b8a2-37149ecbfa23', 25, NULL, 'per gram'),
('Santan Kara (sachet)', 'raw', 'kitchen', 'dbc921bb-042f-4780-9b9d-a1c3db812e61', 5000, NULL, 'per sachet 65ml'),
('Tepung Bumbu Serbaguna', 'raw', 'kitchen', '90222804-fe6a-4b4d-b8a2-37149ecbfa23', 15, NULL, 'per gram, untuk fried chicken'),

-- KITCHEN — PACKAGING
('Box Makan Kertas', 'packaging', 'kitchen', 'c1eaae22-0bd7-4ac4-97df-90778e7cff1a', 1500, NULL, NULL),
('Kantong Kertas Takeaway', 'packaging', 'kitchen', 'c1eaae22-0bd7-4ac4-97df-90778e7cff1a', 1000, NULL, NULL),
('Sendok Plastik', 'packaging', 'kitchen', 'c1eaae22-0bd7-4ac4-97df-90778e7cff1a', 200, NULL, NULL),
('Garpu Plastik', 'packaging', 'kitchen', 'c1eaae22-0bd7-4ac4-97df-90778e7cff1a', 200, NULL, NULL),
('Aluminium Foil', 'packaging', 'kitchen', '90222804-fe6a-4b4d-b8a2-37149ecbfa23', 5, NULL, 'per gram'),

-- ============================================================
-- KITCHEN — PROCESSED (hasil produksi dari 11 production chains)
-- ============================================================

-- Chain 1: Buntut/Iga Sapi
('Buntut Sapi Olahan @150gr', 'processed', 'kitchen', 'a37de0d2-ab0c-4816-a2b2-78ab89d092ea', 0, 150, 'Buntut rebus/goreng siap saji'),
('Iga Sapi Olahan @150gr', 'processed', 'kitchen', 'a37de0d2-ab0c-4816-a2b2-78ab89d092ea', 0, 150, 'Iga rebus/goreng siap saji'),
('Iga Suir', 'processed', 'kitchen', 'a37de0d2-ab0c-4816-a2b2-78ab89d092ea', 0, NULL, 'Iga yang disuwir untuk nasi goreng'),

-- Chain 2: Daging Sapi
('Daging Soto @40gr', 'processed', 'kitchen', 'a37de0d2-ab0c-4816-a2b2-78ab89d092ea', 0, 40, 'Daging sapi rebus untuk soto'),
('Beef Patty @50gr', 'processed', 'kitchen', 'a37de0d2-ab0c-4816-a2b2-78ab89d092ea', 0, 50, 'Patty burger beef'),
('Beef Patty Slider', 'processed', 'kitchen', 'a37de0d2-ab0c-4816-a2b2-78ab89d092ea', 0, 30, 'Mini patty untuk slider'),
('Daging Bolognaise', 'processed', 'kitchen', 'a37de0d2-ab0c-4816-a2b2-78ab89d092ea', 0, NULL, 'Saus bolognaise untuk pasta'),

-- Chain 3: Ayam Utuh
('Ayam Berlaris (whole)', 'processed', 'kitchen', 'a37de0d2-ab0c-4816-a2b2-78ab89d092ea', 0, NULL, 'Ayam utuh bumbu berlaris siap saji'),
('Ayam Suir @20gr', 'processed', 'kitchen', 'a37de0d2-ab0c-4816-a2b2-78ab89d092ea', 0, 20, 'Ayam suwir untuk nasi, soto, dll'),
('Ayam Dadu', 'processed', 'kitchen', 'a37de0d2-ab0c-4816-a2b2-78ab89d092ea', 0, NULL, 'Ayam potong dadu untuk menu tertentu'),
('Dada Ayam Slice', 'processed', 'kitchen', 'a37de0d2-ab0c-4816-a2b2-78ab89d092ea', 0, NULL, 'Dada ayam iris tipis'),
('Paha Ayam Dungdung', 'processed', 'kitchen', 'a37de0d2-ab0c-4816-a2b2-78ab89d092ea', 0, NULL, 'Paha goreng crispy'),

-- Chain 4: Kambing
('Daging Kambing @50gr', 'processed', 'kitchen', 'a37de0d2-ab0c-4816-a2b2-78ab89d092ea', 0, 50, 'Daging kambing rebus siap saji'),

-- Chain 5: Bebek
('Bebek Olahan', 'processed', 'kitchen', 'a37de0d2-ab0c-4816-a2b2-78ab89d092ea', 0, NULL, 'Bebek bumbu siap goreng/bakar'),
('Bumbu Bebek', 'processed', 'kitchen', 'a37de0d2-ab0c-4816-a2b2-78ab89d092ea', 0, NULL, 'Bumbu marinasi bebek'),

-- Chain 6: Smoked Beef
('Smoked Beef @20gr', 'processed', 'kitchen', 'a37de0d2-ab0c-4816-a2b2-78ab89d092ea', 0, 20, 'Smoked beef iris @20gr'),

-- Chain 7 & 8: Seafood
('Mix Seafood @30gr', 'processed', 'kitchen', 'a37de0d2-ab0c-4816-a2b2-78ab89d092ea', 0, 30, 'Campuran udang+cumi+dori @30gr per porsi'),
('Fish and Chips @100gr', 'processed', 'kitchen', 'a37de0d2-ab0c-4816-a2b2-78ab89d092ea', 0, 100, 'Ikan dori breaded siap goreng'),

-- Chain 9: Springroll & Risol
('Springroll @5pcs', 'processed', 'kitchen', 'a37de0d2-ab0c-4816-a2b2-78ab89d092ea', 0, NULL, 'Lumpia isi siap goreng, per porsi 5 pcs'),
('Risol Soto', 'processed', 'kitchen', 'a37de0d2-ab0c-4816-a2b2-78ab89d092ea', 0, NULL, 'Risol isi soto siap goreng'),

-- Chain 10: Corn Tortila
('Kulit Corn Tortila (porsi)', 'processed', 'kitchen', 'a37de0d2-ab0c-4816-a2b2-78ab89d092ea', 0, NULL, 'Tortila dipotong jadi porsi menu'),

-- Chain 11: Singkong
('Singkong @200gr', 'processed', 'kitchen', 'a37de0d2-ab0c-4816-a2b2-78ab89d092ea', 0, 200, 'Singkong rebus/goreng @200gr'),
('Singkong @100gr', 'processed', 'kitchen', 'a37de0d2-ab0c-4816-a2b2-78ab89d092ea', 0, 100, 'Singkong rebus/goreng @100gr');

-- Verify
SELECT ingredient_type, division, COUNT(*) as jumlah
FROM ingredients
GROUP BY ingredient_type, division
ORDER BY ingredient_type, division;
