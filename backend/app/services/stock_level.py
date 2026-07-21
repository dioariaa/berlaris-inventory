"""
Kalkulasi current stock per ingredient — PURE LEDGER.

Formula (akumulasi semua transaksi sejak sistem pertama kali dipakai):
  current_stock =
    SUM(receipt_items.received_qty)            ← bahan masuk dari pembelian
    + SUM(production_batches.portions_actual)  ← porsi processed yang selesai diproduksi
    - SUM(production_batches.raw_qty_used)     ← bahan raw yang dipakai untuk produksi
    - SUM(theoretical_consumption.consumed_qty)← bahan keluar karena penjualan (teori)
    - SUM(waste_logs.qty)                      ← bahan terbuang/rusak
    + SUM(stock_adjustments.qty_delta)         ← rekonsiliasi manual

Semua qty dinormalisasi ke base_unit ingredient:
  - raw_qty_used dikonversi dari raw_unit_id batch → base unit raw ingredient
  - portions_actual (jumlah porsi) dikonversi ke g/ml via process.portion_size_g
    jika base unit output adalah gram/ml; selain itu dipakai apa adanya (porsi/pcs)

Lokasi (storage vs division) — 6 lokasi: storage_bar, storage_kitchen, bar,
kitchen, staff_meal, operational. DERIVED by rule:
  - receipts           → po_category item (kategori Belanja Harian = lokasi masuk);
                         NULL (initial stock / receipt lama) → storage sesuai
                         division ingredient (bar → storage_bar, else storage_kitchen)
  - production in/out  → division output ingredient (bar/kitchen)
  - consumption/waste/adjustment → division ingredient itu sendiri
  - stock_transfers    → eksplisit from_location → to_location
  Movement keluar (sales/production/waste/transfer) dijaga stock_guard.py agar
  tidak pernah negatif; satu-satunya jalan stok minus adalah stock_adjustments
  (koreksi opname, sengaja tanpa guard).

Opname TIDAK dipakai di sini. Opname hanya dipakai di variance_reports
sebagai ground truth pembanding terhadap theoretical_closing.
"""
import logging
from collections import defaultdict

from supabase import Client

from app.services.supabase import get_supabase_admin
from app.services.consumption import _build_conversion_cache

logger = logging.getLogger(__name__)

LOCATIONS = ["storage_bar", "storage_kitchen", "bar", "kitchen", "staff_meal", "operational"]


def _division_location(division: str | None) -> str:
    # ponytail: division 'both'/unknown dipetakan ke kitchen; pisahkan kalau
    # nanti ada ingredient 'both' yang benar-benar dipakai dua divisi sekaligus
    return division if division in ("bar", "kitchen") else "kitchen"


def _storage_location(division: str | None) -> str:
    return "storage_bar" if division == "bar" else "storage_kitchen"


def _convert(qty: float, from_unit: str, to_unit: str | None, cache: dict) -> float:
    """Konversi qty antar unit via cache; unit sama / tidak ada konversi → as-is."""
    if not to_unit or from_unit == to_unit:
        return qty
    factor = cache.get((from_unit, to_unit))
    if factor is None:
        logger.warning("stock_level: no unit conversion (%s → %s), qty as-is", from_unit, to_unit)
        return qty
    return qty * factor


def get_current_stock(ingredient_ids: list[str] | None = None, client: Client | None = None) -> list[dict]:
    """
    Returns list of dicts with:
      ingredient_id, ingredient_name, division, ingredient_type,
      base_unit_id, unit_name, unit_symbol,
      receipts_total, production_out_total, production_raw_used,
      consumption_total, waste_total, adjustments_total,
      current_stock, locations {storage|bar|kitchen|staff_meal|operational: qty},
      min_threshold, is_critical, is_low
    """
    if client is None:
        client = get_supabase_admin()

    # ── 1. Semua ingredient aktif ──────────────────────────────────────────────
    q = (
        client.table("ingredients")
        .select(
            "id, name, division, ingredient_type, base_unit_id, min_threshold,"
            " avg_cost_per_unit, unit:units!base_unit_id(name, symbol)"
        )
        .eq("is_active", True)
    )
    if ingredient_ids:
        q = q.in_("id", ingredient_ids)

    ing_rows = q.execute().data or []
    if not ing_rows:
        return []

    ids = [r["id"] for r in ing_rows]
    ids_set = set(ids)

    # Map ringan SEMUA ingredient (termasuk di luar filter) — dibutuhkan untuk
    # menentukan base unit & division pihak lain dalam production batch.
    all_ing = (
        client.table("ingredients")
        .select("id, division, base_unit_id")
        .execute()
        .data
    ) or []
    ing_meta = {r["id"]: r for r in all_ing}

    unit_symbol = {
        u["id"]: u["symbol"]
        for u in (client.table("units").select("id, symbol").execute().data or [])
    }

    # Per-ingredient per-location flow
    loc_flow: dict[str, dict[str, float]] = defaultdict(lambda: defaultdict(float))

    # ── 2. Bahan masuk: goods receipts → po_category / storage division ───────
    receipt_rows = (
        client.table("receipt_items")
        .select("ingredient_id, received_qty, po_category")
        .in_("ingredient_id", ids)
        .execute()
        .data
    ) or []

    receipts: dict[str, float] = {}
    for r in receipt_rows:
        iid = r["ingredient_id"]
        qty = float(r["received_qty"])
        receipts[iid] = receipts.get(iid, 0.0) + qty
        cat = r.get("po_category")
        loc = cat if cat in LOCATIONS else _storage_location((ing_meta.get(iid) or {}).get("division"))
        loc_flow[iid][loc] += qty

    # ── 3. Produksi: join production_batches × production_processes ───────────
    # portions_actual → inflow untuk output_ingredient_id (processed)
    # raw_qty_used    → outflow untuk raw_ingredient_id (raw)
    # Keduanya dikonversi ke base unit ingredient masing-masing.
    batch_rows = (
        client.table("production_batches")
        .select(
            "raw_qty_used, raw_unit_id, portions_actual,"
            " process:production_processes!process_id("
            "   raw_ingredient_id, output_ingredient_id, portion_size_g)"
        )
        .execute()
        .data
    ) or []

    # Konversi raw_unit_id batch → base unit raw ingredient
    unit_pairs: set[tuple[str, str]] = set()
    for b in batch_rows:
        proc = b.get("process") or {}
        raw_meta = ing_meta.get(proc.get("raw_ingredient_id")) or {}
        base = raw_meta.get("base_unit_id")
        if base and b["raw_unit_id"] != base:
            unit_pairs.add((b["raw_unit_id"], base))
    conv_cache = _build_conversion_cache(client, unit_pairs)

    prod_out: dict[str, float] = {}       # processed ingredient inflow
    prod_raw_used: dict[str, float] = {}  # raw ingredient outflow via production

    for b in batch_rows:
        proc    = b.get("process") or {}
        raw_iid = proc.get("raw_ingredient_id")
        out_iid = proc.get("output_ingredient_id")
        out_meta = ing_meta.get(out_iid) or {}
        # Produksi terjadi di division output-nya (bar/kitchen)
        prod_loc = _division_location(out_meta.get("division"))

        if raw_iid and raw_iid in ids_set:
            raw_base = (ing_meta.get(raw_iid) or {}).get("base_unit_id")
            qty = _convert(float(b["raw_qty_used"]), b["raw_unit_id"], raw_base, conv_cache)
            prod_raw_used[raw_iid] = prod_raw_used.get(raw_iid, 0.0) + qty
            loc_flow[raw_iid][prod_loc] -= qty

        if out_iid and out_iid in ids_set:
            portions = float(b["portions_actual"])
            out_symbol = unit_symbol.get(out_meta.get("base_unit_id"))
            portion_size = float(proc.get("portion_size_g") or 0)
            # Base unit g/ml → porsi × portion_size_g; base unit porsi/pcs → as-is
            qty = portions * portion_size if out_symbol in ("g", "ml") and portion_size > 0 else portions
            prod_out[out_iid] = prod_out.get(out_iid, 0.0) + qty
            loc_flow[out_iid][prod_loc] += qty

    # ── 4. Konsumsi teoritis dari penjualan → division ingredient ─────────────
    tc_rows = (
        client.table("theoretical_consumption")
        .select("ingredient_id, consumed_qty")
        .in_("ingredient_id", ids)
        .execute()
        .data
    ) or []

    consumption: dict[str, float] = {}
    for r in tc_rows:
        iid = r["ingredient_id"]
        qty = float(r["consumed_qty"])
        consumption[iid] = consumption.get(iid, 0.0) + qty
        loc_flow[iid][_division_location((ing_meta.get(iid) or {}).get("division"))] -= qty

    # ── 5. Waste → division ingredient ─────────────────────────────────────────
    waste_rows = (
        client.table("waste_logs")
        .select("ingredient_id, qty")
        .in_("ingredient_id", ids)
        .execute()
        .data
    ) or []

    waste: dict[str, float] = {}
    for r in waste_rows:
        iid = r["ingredient_id"]
        qty = float(r["qty"])
        waste[iid] = waste.get(iid, 0.0) + qty
        loc_flow[iid][_division_location((ing_meta.get(iid) or {}).get("division"))] -= qty

    # ── 5b. Stock adjustments (reconciliation) → division ingredient ──────────
    adjustment_rows = (
        client.table("stock_adjustments")
        .select("ingredient_id, qty_delta")
        .in_("ingredient_id", ids)
        .execute()
        .data
    ) or []

    adjustments: dict[str, float] = {}
    for r in adjustment_rows:
        iid = r["ingredient_id"]
        qty = float(r["qty_delta"])
        adjustments[iid] = adjustments.get(iid, 0.0) + qty
        loc_flow[iid][_division_location((ing_meta.get(iid) or {}).get("division"))] += qty

    # ── 5c. Transfers antar lokasi (net-zero terhadap total) ───────────────────
    try:
        transfer_rows = (
            client.table("stock_transfers")
            .select("ingredient_id, qty, from_location, to_location")
            .in_("ingredient_id", ids)
            .execute()
            .data
        ) or []
    except Exception:
        # Tabel belum ada (migration belum dijalankan) — anggap belum ada transfer
        transfer_rows = []

    for r in transfer_rows:
        iid = r["ingredient_id"]
        qty = float(r["qty"])
        loc_flow[iid][r["from_location"]] -= qty
        loc_flow[iid][r["to_location"]]   += qty

    # ── 6. Hitung current_stock per ingredient ────────────────────────────────
    results = []
    for ing in ing_rows:
        iid  = ing["id"]
        unit = ing.get("unit") or {}

        receipts_total      = round(receipts.get(iid, 0.0), 3)
        prod_out_total      = round(prod_out.get(iid, 0.0), 3)
        prod_raw_used_total = round(prod_raw_used.get(iid, 0.0), 3)
        consumption_total   = round(consumption.get(iid, 0.0), 3)
        waste_total         = round(waste.get(iid, 0.0), 3)
        adjustments_total   = round(adjustments.get(iid, 0.0), 3)

        current_stock = round(
            receipts_total + prod_out_total
            - prod_raw_used_total - consumption_total - waste_total
            + adjustments_total,
            3,
        )

        # Stok OPERASIONAL = yang sudah ada di division (siap pakai).
        # Stok storage TIDAK dihitung sebelum ditransfer ke division —
        # flag kritis/rendah dan ketersediaan menu berbasis division_stock.
        division_stock = round(loc_flow[iid][_division_location(ing["division"])], 3)
        storage_stock  = round(loc_flow[iid][_storage_location(ing["division"])], 3)

        threshold   = float(ing.get("min_threshold") or 0.0)
        is_critical = threshold > 0 and division_stock <= threshold
        is_low      = threshold > 0 and division_stock <= threshold * 1.5

        results.append({
            "ingredient_id":         iid,
            "ingredient_name":       ing["name"],
            "division":              ing["division"],
            "ingredient_type":       ing["ingredient_type"],
            "base_unit_id":          ing["base_unit_id"],
            "unit_name":             unit.get("name"),
            "unit_symbol":           unit.get("symbol"),
            "avg_cost_per_unit":     float(ing.get("avg_cost_per_unit") or 0),
            "receipts_total":        receipts_total,
            "production_out_total":  prod_out_total,
            "production_raw_used":   prod_raw_used_total,
            "consumption_total":     consumption_total,
            "waste_total":           waste_total,
            "adjustments_total":     adjustments_total,
            "current_stock":         current_stock,
            "division_stock":        division_stock,
            "storage_stock":         storage_stock,
            "locations":             {loc: round(loc_flow[iid][loc], 3) for loc in LOCATIONS},
            "min_threshold":         round(threshold, 3),
            "is_critical":           is_critical,
            "is_low":                is_low,
        })

    # Sort: kritis dulu, lalu rendah, lalu nama
    results.sort(key=lambda x: (not x["is_critical"], not x["is_low"], x["ingredient_name"]))
    return results
