"""
Kalkulasi HPP per menu per bulan.

Formula (CLAUDE.md):
    hpp = SUM(recipe.qty_in_base_unit × effective_cost_ingredient)

    Untuk processed ingredient:
        effective_cost = avg_cost_per_unit / cumulative_yield
        (cumulative_yield = PRODUCT(stage.yield_pct/100) dari production_stages)

    Untuk raw ingredient:
        effective_cost = avg_cost_per_unit

    Untuk packaging:
        SKIP — tidak masuk HPP

    Unit conversion:
        Jika recipe.unit_id ≠ ingredient.base_unit_id, qty di-convert dulu.
        conversion_factor: direct lookup → reverse (1/factor) → fallback 1.0

    food_cost_pct = hpp_total / selling_price × 100

Disimpan ke menu_hpp dengan periode bulan (period_month = first day of month).
"""
from __future__ import annotations

import logging
from datetime import date
from decimal import Decimal

from supabase import Client

from app.services.supabase import get_supabase_admin
from app.services.yield_calc import get_cumulative_yield

logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────────────────────
# Unit conversion cache
# ─────────────────────────────────────────────────────────────────────────────

def _build_conversion_cache(
    client: Client,
    unit_pairs: set[tuple[str, str]],
) -> dict[tuple[str, str], float]:
    """
    Buat cache konversi untuk semua pasangan (from_unit_id, to_unit_id) yang dibutuhkan.

    Pertama cari direct conversion, lalu derive reverse (1/factor) untuk yang tidak ditemukan.
    Pasangan yang sama unit (from == to) di-skip — factor selalu 1.0.
    """
    needed = {(f, t) for f, t in unit_pairs if f != t}
    if not needed:
        return {}

    all_from = list({f for f, _ in needed})
    all_to   = list({t for _, t in needed})

    # Fetch semua konversi yang mungkin relevan dalam 1 query
    rows = (
        client.table("unit_conversions")
        .select("from_unit_id, to_unit_id, factor")
        .in_("from_unit_id", list(set(all_from + all_to)))
        .in_("to_unit_id",   list(set(all_from + all_to)))
        .execute()
        .data
    )

    direct: dict[tuple[str, str], float] = {
        (r["from_unit_id"], r["to_unit_id"]): float(r["factor"])
        for r in rows
    }

    cache: dict[tuple[str, str], float] = {}
    for from_u, to_u in needed:
        if (from_u, to_u) in direct:
            cache[(from_u, to_u)] = direct[(from_u, to_u)]
        elif (to_u, from_u) in direct:
            cache[(from_u, to_u)] = 1.0 / direct[(to_u, from_u)]
        else:
            logger.warning(
                "HPP: tidak ada konversi unit %s → %s, factor=1.0 diasumsikan",
                from_u, to_u,
            )
            cache[(from_u, to_u)] = 1.0

    return cache


# ─────────────────────────────────────────────────────────────────────────────
# Main function
# ─────────────────────────────────────────────────────────────────────────────

def recalc_hpp(
    menu_id:      str,
    period_month: date | None = None,
    client:       Client | None = None,
) -> dict:
    """
    Recalculate HPP untuk satu menu pada period_month.

    Args:
        menu_id:      UUID menu_items
        period_month: Bulan HPP (default: awal bulan ini)
        client:       Supabase admin client (default: buat baru)

    Returns:
        dict dengan hpp, food_cost_pct, ingredient_breakdown, warnings
    """
    if client is None:
        client = get_supabase_admin()
    if period_month is None:
        today        = date.today()
        period_month = date(today.year, today.month, 1)

    # ── 1. Fetch menu ────────────────────────────────────────────────────────
    menu = (
        client.table("menu_items")
        .select("id, name, selling_price")
        .eq("id", menu_id)
        .single()
        .execute()
        .data
    )

    # ── 2. Fetch recipes (BOM) dengan ingredient info ────────────────────────
    #      Ambil unit_id recipe DAN base_unit_id ingredient untuk konversi
    recipes = (
        client.table("recipes")
        .select(
            "ingredient_id, qty, unit_id,"
            " ingredients(avg_cost_per_unit, ingredient_type, base_unit_id, name)"
        )
        .eq("menu_id", menu_id)
        .execute()
        .data
    )

    if not recipes:
        logger.info("Menu %s tidak punya recipe — HPP = 0", menu_id)
        _upsert_menu_hpp(client, menu_id, period_month, Decimal("0"), Decimal("0"))
        return _empty_result(menu, period_month)

    # ── 3. Batch: cari production process untuk semua processed ingredient ───
    #      ingredients tidak punya kolom production_process_id;
    #      relasi: production_processes.output_ingredient_id → ingredient.id
    processed_ids = [
        item["ingredient_id"] for item in recipes
        if (item.get("ingredients") or {}).get("ingredient_type") == "processed"
    ]

    process_map: dict[str, str] = {}   # ingredient_id → process_id
    if processed_ids:
        procs = (
            client.table("production_processes")
            .select("id, output_ingredient_id")
            .in_("output_ingredient_id", processed_ids)
            .eq("is_active", True)
            .execute()
            .data
        )
        for p in procs:
            process_map[p["output_ingredient_id"]] = p["id"]

    # ── 4. Build unit conversion cache ──────────────────────────────────────
    unit_pairs: set[tuple[str, str]] = set()
    for item in recipes:
        ing          = item.get("ingredients") or {}
        recipe_unit  = item.get("unit_id")
        base_unit    = ing.get("base_unit_id")
        if recipe_unit and base_unit and recipe_unit != base_unit:
            unit_pairs.add((recipe_unit, base_unit))

    conversion_cache = _build_conversion_cache(client, unit_pairs)

    # ── 5. Hitung HPP per ingredient ─────────────────────────────────────────
    hpp      = Decimal("0")
    warnings: list[str] = []
    breakdown: list[dict] = []

    for item in recipes:
        ing           = item.get("ingredients") or {}
        ing_type      = ing.get("ingredient_type", "raw")
        ing_name      = ing.get("name", item["ingredient_id"])
        recipe_unit   = item.get("unit_id")
        base_unit     = ing.get("base_unit_id")

        # ── a. Packaging: SKIP — tidak masuk HPP ────────────────────────────
        if ing_type == "packaging":
            breakdown.append({
                "ingredient_id":   item["ingredient_id"],
                "ingredient_name": ing_name,
                "ingredient_type": "packaging",
                "skipped":         True,
                "skip_reason":     "packaging tidak masuk HPP",
            })
            continue

        avg_cost = Decimal(str(ing.get("avg_cost_per_unit") or 0))
        qty      = Decimal(str(item["qty"]))

        # ── b. Unit conversion: recipe qty → base_unit qty ──────────────────
        if recipe_unit and base_unit and recipe_unit != base_unit:
            factor = conversion_cache.get((recipe_unit, base_unit), 1.0)
            qty_base = qty * Decimal(str(factor))
        else:
            qty_base = qty
            factor   = 1.0

        # ── c. Effective cost berdasarkan ingredient type ────────────────────
        if ing_type == "processed":
            process_id = process_map.get(item["ingredient_id"])
            if process_id:
                raw_yield       = get_cumulative_yield(process_id, client)
                cumulative_yield = Decimal(str(raw_yield))
                if cumulative_yield > 0:
                    effective_cost = avg_cost / cumulative_yield
                else:
                    effective_cost = avg_cost
                    warnings.append(
                        f"{ing_name}: cumulative_yield = 0, effective_cost = avg_cost"
                    )
            else:
                effective_cost = avg_cost
                warnings.append(
                    f"{ing_name}: tidak ada production process aktif — "
                    "effective_cost = avg_cost (tanpa yield adjustment)"
                )
                raw_yield        = None
                cumulative_yield = None
        else:
            # raw
            effective_cost   = avg_cost
            raw_yield        = None
            cumulative_yield = None

        # ── d. Contribution ke HPP ───────────────────────────────────────────
        ingredient_hpp = qty_base * effective_cost
        hpp += ingredient_hpp

        breakdown.append({
            "ingredient_id":    item["ingredient_id"],
            "ingredient_name":  ing_name,
            "ingredient_type":  ing_type,
            "recipe_qty":       float(qty),
            "recipe_unit_id":   recipe_unit,
            "base_unit_id":     base_unit,
            "conversion_factor": factor,
            "qty_in_base_unit": float(qty_base),
            "avg_cost_per_unit": float(avg_cost),
            "cumulative_yield":  float(cumulative_yield) if cumulative_yield is not None else None,
            "effective_cost":    float(effective_cost),
            "ingredient_hpp":    float(ingredient_hpp),
            "skipped":           False,
        })

    # ── 6. food_cost_pct ─────────────────────────────────────────────────────
    selling_price = Decimal(str(menu["selling_price"] or 0))
    food_cost_pct = (hpp / selling_price * 100) if selling_price > 0 else Decimal("0")
    # ponytail: clamp to DB column limit — placeholder selling_price=1 can overflow
    food_cost_pct = min(food_cost_pct, Decimal("999.99"))

    # ── 7. Upsert ke menu_hpp ────────────────────────────────────────────────
    _upsert_menu_hpp(client, menu_id, period_month, hpp, food_cost_pct)

    logger.info(
        "HPP recalc: '%s' period=%s hpp=%.2f food_cost=%.1f%% (%d ingredients, %d warnings)",
        menu["name"], period_month.isoformat(), float(hpp), float(food_cost_pct),
        len([b for b in breakdown if not b.get("skipped")]),
        len(warnings),
    )

    return {
        "menu_id":              menu_id,
        "menu_name":            menu["name"],
        "period_month":         period_month.isoformat(),
        "hpp":                  float(hpp),
        "selling_price":        float(selling_price),
        "food_cost_pct":        float(food_cost_pct),
        "ingredients_count":    len([b for b in breakdown if not b.get("skipped")]),
        "ingredient_breakdown": breakdown,
        "warnings":             warnings,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _upsert_menu_hpp(
    client:        Client,
    menu_id:       str,
    period_month:  date,
    hpp:           Decimal,
    food_cost_pct: Decimal,
) -> None:
    """Upsert satu baris ke menu_hpp. UNIQUE constraint: (menu_id, period_month)."""
    client.table("menu_hpp").upsert(
        {
            "menu_id":       menu_id,
            "period_month":  period_month.isoformat(),
            "hpp_amount":    float(hpp),
            "food_cost_pct": float(food_cost_pct),
        },
        on_conflict="menu_id,period_month",
    ).execute()


def _empty_result(menu: dict, period_month: date) -> dict:
    return {
        "menu_id":              menu["id"],
        "menu_name":            menu["name"],
        "period_month":         period_month.isoformat(),
        "hpp":                  0.0,
        "selling_price":        float(menu.get("selling_price") or 0),
        "food_cost_pct":        0.0,
        "ingredients_count":    0,
        "ingredient_breakdown": [],
        "warnings":             [],
    }


# ─────────────────────────────────────────────────────────────────────────────
# Bulk recalc
# ─────────────────────────────────────────────────────────────────────────────

def recalc_all_hpp(
    period_month: date | None = None,
    client:       Client | None = None,
) -> list[dict]:
    """
    Recalculate HPP untuk semua menu aktif pada period_month.
    Berguna untuk bulk recalc setelah harga bahan berubah massal.
    """
    if client is None:
        client = get_supabase_admin()
    if period_month is None:
        today        = date.today()
        period_month = date(today.year, today.month, 1)

    menus = (
        client.table("menu_items")
        .select("id")
        .eq("is_active", True)
        .execute()
        .data
    )

    results = []
    for m in menus:
        try:
            r = recalc_hpp(m["id"], period_month, client)
            results.append(r)
        except Exception as exc:
            logger.error("HPP recalc gagal untuk menu %s: %s", m["id"], exc)

    logger.info("recalc_all_hpp: %d menu(s) pada %s", len(results), period_month.isoformat())
    return results
