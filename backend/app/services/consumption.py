"""
Kalkulasi theoretical_consumption harian dari sales entries × BOM.

Formula (per ingredient):
  consumed_qty = SUM over all sold menus of (qty_sold × recipe.qty)

Semua quantity dikonversi ke base_unit ingredient sebelum dijumlah.
Unit conversion: unit_conversions.factor = qty_in_to_unit per 1 qty_in_from_unit.
Reverse conversion diderivasi otomatis jika hanya ada satu arah di DB.

Dipanggil setiap kali POST /sales-entry di-submit.
Hasil di-upsert ke theoretical_consumption (UNIQUE: consumption_date + ingredient_id).
"""
from datetime import date
from collections import defaultdict
from supabase import Client
import logging

logger = logging.getLogger(__name__)


def _build_conversion_cache(
    client: Client,
    unit_pairs: set[tuple[str, str]],
) -> dict[tuple[str, str], float]:
    """
    Fetch conversion factors untuk pasangan (from_unit_id, to_unit_id).
    Juga derive konversi balik jika hanya arah sebaliknya yang ada di DB.

    Returns dict: (from_unit_id, to_unit_id) → float factor
    """
    if not unit_pairs:
        return {}

    all_from = list({p[0] for p in unit_pairs})
    all_to   = list({p[1] for p in unit_pairs})

    cache: dict[tuple[str, str], float] = {}

    # Coba konversi langsung: from → to
    rows = (
        client.table("unit_conversions")
        .select("from_unit_id, to_unit_id, factor")
        .in_("from_unit_id", all_from)
        .in_("to_unit_id", all_to)
        .execute()
        .data
    )
    for r in rows:
        cache[(r["from_unit_id"], r["to_unit_id"])] = float(r["factor"])

    # Untuk pasangan yang masih belum ditemukan, coba konversi terbalik (to → from)
    # dan inverse factor-nya
    missing = unit_pairs - cache.keys()
    if missing:
        rev_from = list({p[1] for p in missing})
        rev_to   = list({p[0] for p in missing})
        rev_rows = (
            client.table("unit_conversions")
            .select("from_unit_id, to_unit_id, factor")
            .in_("from_unit_id", rev_from)
            .in_("to_unit_id", rev_to)
            .execute()
            .data
        )
        for r in rev_rows:
            # Konversi balik: jika DB tahu (B→A) dengan factor f,
            # maka (A→B) = 1/f
            forward_key = (r["to_unit_id"], r["from_unit_id"])
            if forward_key not in cache:
                cache[forward_key] = 1.0 / float(r["factor"])

    # Log pasangan yang tidak bisa dikonversi
    still_missing = unit_pairs - cache.keys()
    if still_missing:
        for pair in still_missing:
            logger.warning(
                "consumption: no unit conversion found (%s → %s) — using qty as-is",
                pair[0], pair[1],
            )

    return cache


def calculate_theoretical_consumption(consumption_date: date, client: Client) -> int:
    """
    Recalculate theoretical consumption untuk satu tanggal dari daily_sales_entries.

    Steps:
      1. Ambil semua sales entries (qty_sold > 0) untuk tanggal ini
      2. Batch-fetch BOM (recipes) untuk semua menu yang terjual
      3. Fetch base_unit_id tiap ingredient yang ada di BOM
      4. Resolve unit conversions: recipe.unit → ingredient.base_unit
      5. Agregasi: consumed_qty[ingredient_id] = SUM(qty_sold × recipe_qty_in_base_unit)
      6. Upsert ke theoretical_consumption; hapus baris lama yang sudah tidak relevan

    Returns:
        Jumlah ingredient rows yang di-upsert ke theoretical_consumption.
    """
    date_str = consumption_date.isoformat()

    # ── 1. Sales entries ──────────────────────────────────────────────────────
    sales = (
        client.table("daily_sales_entries")
        .select("menu_id, qty_sold")
        .eq("entry_date", date_str)
        .gt("qty_sold", 0)
        .execute()
        .data
    )

    if not sales:
        # Tidak ada penjualan — hapus konsumsi lama jika ada
        client.table("theoretical_consumption").delete().eq("consumption_date", date_str).execute()
        logger.info("consumption(%s): no sales, cleared existing records", date_str)
        return 0

    menu_ids: list[str]         = list({s["menu_id"] for s in sales})
    qty_by_menu: dict[str, int] = {s["menu_id"]: int(s["qty_sold"]) for s in sales}

    # ── 2. BOM (recipes) untuk semua menu yang terjual ───────────────────────
    recipes = (
        client.table("recipes")
        .select("menu_id, ingredient_id, qty, unit_id")
        .in_("menu_id", menu_ids)
        .execute()
        .data
    )

    if not recipes:
        logger.warning(
            "consumption(%s): %d menus sold but no recipes configured",
            date_str, len(menu_ids),
        )
        return 0

    # ── 3. Base unit tiap ingredient yang muncul di BOM ──────────────────────
    ingredient_ids: list[str] = list({r["ingredient_id"] for r in recipes})
    ing_data = (
        client.table("ingredients")
        .select("id, base_unit_id, division")
        .in_("id", ingredient_ids)
        .execute()
        .data
    )
    base_unit_map: dict[str, str] = {i["id"]: i["base_unit_id"] for i in ing_data}
    division_map:  dict[str, str] = {i["id"]: i["division"] for i in ing_data}

    # ── 4. Kumpulkan pasangan unit yang butuh konversi ────────────────────────
    unit_pairs: set[tuple[str, str]] = set()
    for r in recipes:
        ing_id    = r["ingredient_id"]
        base_unit = base_unit_map.get(ing_id)
        if base_unit and r["unit_id"] != base_unit:
            unit_pairs.add((r["unit_id"], base_unit))

    conversion_cache = _build_conversion_cache(client, unit_pairs)

    # ── 5. Agregasi ke base unit ──────────────────────────────────────────────
    consumed: dict[str, float]  = defaultdict(float)
    unit_out: dict[str, str]    = {}   # ingredient_id → unit_id untuk disimpan ke DB

    for r in recipes:
        qty_sold = qty_by_menu.get(r["menu_id"], 0)
        if qty_sold == 0:
            continue

        ing_id      = r["ingredient_id"]
        recipe_unit = r["unit_id"]
        base_unit   = base_unit_map.get(ing_id)
        recipe_qty  = float(r["qty"])

        # Konversi ke base unit jika perlu
        if base_unit and recipe_unit != base_unit:
            factor = conversion_cache.get((recipe_unit, base_unit))
            if factor is not None:
                recipe_qty *= factor
            # else: konversi tidak ditemukan → pakai qty as-is (sudah di-log di atas)

        consumed[ing_id] += qty_sold * recipe_qty
        unit_out[ing_id]  = base_unit or recipe_unit   # simpan ke DB dalam base unit

    if not consumed:
        return 0

    # ── 5b. Guard stok negatif — cek SEBELUM upsert apa pun ──────────────────
    # Konsumsi diambil dari lokasi DIVISION ingredient (bukan storage).
    # Ledger masih berisi consumption lama tanggal ini → yang di-guard adalah
    # DELTA (kenaikan konsumsi vs yang sudah tercatat), bukan totalnya.
    from app.services.stock_guard import assert_sufficient_stock_many
    from app.services.stock_level import _division_location

    old_rows = (
        client.table("theoretical_consumption")
        .select("ingredient_id, consumed_qty")
        .eq("consumption_date", date_str)
        .execute()
        .data
    ) or []
    old_qty = {r["ingredient_id"]: float(r["consumed_qty"]) for r in old_rows}

    assert_sufficient_stock_many([
        (iid, _division_location(division_map.get(iid)), qty - old_qty.get(iid, 0.0))
        for iid, qty in consumed.items()
    ], client)

    # ── 6. Upsert + cleanup ───────────────────────────────────────────────────
    records = [
        {
            "consumption_date": date_str,
            "ingredient_id":    ing_id,
            "consumed_qty":     round(qty, 6),
            "unit_id":          unit_out[ing_id],
        }
        for ing_id, qty in consumed.items()
    ]

    client.table("theoretical_consumption").upsert(
        records,
        on_conflict="consumption_date,ingredient_id",
    ).execute()

    # Hapus baris lama untuk ingredient yang sudah tidak terkonsumsi hari ini
    # (terjadi jika resep diedit / menu dihapus dari sales setelah entry sebelumnya)
    active_ing_ids = list(consumed.keys())
    (
        client.table("theoretical_consumption")
        .delete()
        .eq("consumption_date", date_str)
        .not_.in_("ingredient_id", active_ing_ids)
        .execute()
    )

    logger.info(
        "consumption(%s): %d menus → %d ingredient records (unit conversion: %d pairs resolved)",
        date_str, len(menu_ids), len(records), len(conversion_cache),
    )
    return len(records)
