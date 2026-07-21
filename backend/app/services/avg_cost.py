"""
Weighted average cost update setelah goods receipt dikonfirmasi.

Formula (CLAUDE.md):
    new_avg = (old_avg × old_total_qty + new_price_base × new_qty_base)
              / (old_total_qty + new_qty_base)

Semua qty dan harga dinormalisasi ke base_unit ingredient sebelum kalkulasi
supaya SUM history qty selalu konsisten meskipun receipt pakai unit berbeda.

Setelah update avg_cost → trigger HPP recalc otomatis untuk semua menu
yang pakai ingredient ini di recipe.
"""
from __future__ import annotations

import logging
from datetime import date
from supabase import Client

logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────────────────────
# Unit conversion helper
# ─────────────────────────────────────────────────────────────────────────────

def _get_conversion_factor(from_unit_id: str, to_unit_id: str, client: Client) -> float:
    """
    Return factor sehingga qty_in_from × factor = qty_in_to.

    Lookup: direct dulu, lalu reverse (1/factor).
    Return 1.0 jika same unit atau tidak ada konversi.
    """
    if from_unit_id == to_unit_id:
        return 1.0

    direct = (
        client.table("unit_conversions")
        .select("factor")
        .eq("from_unit_id", from_unit_id)
        .eq("to_unit_id", to_unit_id)
        .maybe_single()
        .execute()
        .data
    )
    if direct:
        return float(direct["factor"])

    reverse = (
        client.table("unit_conversions")
        .select("factor")
        .eq("from_unit_id", to_unit_id)
        .eq("to_unit_id", from_unit_id)
        .maybe_single()
        .execute()
        .data
    )
    if reverse:
        return 1.0 / float(reverse["factor"])

    logger.warning(
        "Tidak ada konversi dari unit %s ke %s — factor=1 diasumsikan",
        from_unit_id, to_unit_id,
    )
    return 1.0


# ─────────────────────────────────────────────────────────────────────────────
# Core function
# ─────────────────────────────────────────────────────────────────────────────

def update_avg_cost(
    ingredient_id:      str,
    new_qty:            float,
    new_price_per_unit: float,
    unit_id:            str,
    receipt_item_id:    str | None,
    client:             Client,
) -> dict:
    """
    Hitung dan simpan weighted average cost setelah goods receipt baru.

    Steps:
      1. Fetch ingredient (old avg_cost_per_unit + base_unit_id)
      2. Konversi new_qty dan new_price ke base_unit
      3. SUM qty_received dari ingredient_cost_history (entry base_unit saja)
      4. new_avg = (old_avg × old_total + new_price_base × new_qty_base) / total
      5. Update ingredients.avg_cost_per_unit
      6. Insert ke ingredient_cost_history
      7. Trigger HPP recalc untuk semua menu yang pakai ingredient ini

    Args:
        ingredient_id:      UUID ingredient yang diterima
        new_qty:            Qty yang diterima (dalam unit_id)
        new_price_per_unit: Harga per satuan (dalam unit_id)
        unit_id:            Satuan penerimaan (dari receipt_items.unit_id)
        receipt_item_id:    UUID receipt_items (nullable, untuk audit trail)
        client:             Supabase admin client

    Returns:
        dict dengan old_avg, new_avg, menus_recalculated
    """
    # ── 1. Fetch ingredient ──────────────────────────────────────────────────
    ing = (
        client.table("ingredients")
        .select("id, name, avg_cost_per_unit, base_unit_id")
        .eq("id", ingredient_id)
        .single()
        .execute()
        .data
    )
    if not ing:
        raise ValueError(f"Ingredient {ingredient_id!r} tidak ditemukan")

    old_avg      = float(ing["avg_cost_per_unit"] or 0)
    base_unit_id = ing["base_unit_id"]

    # ── 2. Konversi ke base unit ─────────────────────────────────────────────
    # qty  : new_qty × factor        (e.g. 5 kg × 1000 → 5000 g)
    # price: new_price / factor      (e.g. Rp 415.000/kg ÷ 1000 → Rp 415/g)
    factor         = _get_conversion_factor(unit_id, base_unit_id, client)
    new_qty_base   = new_qty * factor
    new_price_base = new_price_per_unit / factor if factor != 0 else new_price_per_unit

    # ── 3. SUM qty dari history (hanya entry base_unit agar konsisten) ───────
    history_rows = (
        client.table("ingredient_cost_history")
        .select("qty_received")
        .eq("ingredient_id", ingredient_id)
        .eq("unit_id", base_unit_id)
        .execute()
        .data
    )
    old_total_qty = sum(float(h["qty_received"]) for h in history_rows)

    # ── 4. Weighted average ──────────────────────────────────────────────────
    total_qty = old_total_qty + new_qty_base
    if total_qty > 0:
        new_avg = (old_avg * old_total_qty + new_price_base * new_qty_base) / total_qty
    else:
        new_avg = new_price_base

    new_avg = round(new_avg, 2)

    # ── 5. Update ingredients.avg_cost_per_unit ──────────────────────────────
    client.table("ingredients").update(
        {"avg_cost_per_unit": new_avg}
    ).eq("id", ingredient_id).execute()

    # ── 6. Insert ingredient_cost_history ────────────────────────────────────
    client.table("ingredient_cost_history").insert({
        "ingredient_id":     ingredient_id,
        "receipt_item_id":   receipt_item_id,
        "price_per_unit":    new_price_base,
        "qty_received":      new_qty_base,
        "unit_id":           base_unit_id,
        "avg_cost_snapshot": new_avg,
    }).execute()

    logger.info(
        "avg_cost updated: '%s' old=%.2f → new=%.2f "
        "(old_total=%.3f + new=%.3f %s)",
        ing["name"], old_avg, new_avg, old_total_qty, new_qty_base, base_unit_id,
    )

    # ── 7. Trigger HPP recalc ─────────────────────────────────────────────────
    menus_recalculated = _trigger_hpp_recalc(ingredient_id, client)

    return {
        "ingredient_id":      ingredient_id,
        "ingredient_name":    ing["name"],
        "old_avg_cost":       old_avg,
        "new_avg_cost":       new_avg,
        "old_total_qty":      old_total_qty,
        "new_qty_base":       new_qty_base,
        "base_unit_id":       base_unit_id,
        "menus_recalculated": menus_recalculated,
    }


def recompute_avg_cost_from_history(ingredient_id: str, client: Client) -> dict:
    """
    Rekalkulasi ulang avg_cost dari SELURUH ingredient_cost_history —
    dipakai setelah edit/hapus receipt item (koreksi salah input).

    avg = Σ(price_per_unit × qty_received) / Σ(qty_received)   [base unit rows]
    History kosong → avg = 0. Trigger HPP recalc seperti biasa.
    """
    ing = (
        client.table("ingredients")
        .select("id, name, base_unit_id")
        .eq("id", ingredient_id)
        .single()
        .execute()
        .data
    )
    rows = (
        client.table("ingredient_cost_history")
        .select("price_per_unit, qty_received")
        .eq("ingredient_id", ingredient_id)
        .eq("unit_id", ing["base_unit_id"])
        .execute()
        .data
    ) or []

    total_qty = sum(float(r["qty_received"]) for r in rows)
    if total_qty > 0:
        new_avg = round(
            sum(float(r["price_per_unit"]) * float(r["qty_received"]) for r in rows) / total_qty, 2
        )
    else:
        new_avg = 0

    client.table("ingredients").update({"avg_cost_per_unit": new_avg}).eq("id", ingredient_id).execute()
    logger.info("avg_cost recomputed from history: '%s' → %.2f (%d rows)", ing["name"], new_avg, len(rows))

    menus = _trigger_hpp_recalc(ingredient_id, client)
    return {"ingredient_name": ing["name"], "new_avg_cost": new_avg, "menus_recalculated": menus}


# ─────────────────────────────────────────────────────────────────────────────
# HPP cascade
# ─────────────────────────────────────────────────────────────────────────────

def _trigger_hpp_recalc(ingredient_id: str, client: Client) -> list[str]:
    """
    Cari semua menu yang memakai ingredient ini di recipes, lalu recalc HPP.

    Import deferred untuk menghindari circular import (hpp → avg_cost → hpp).
    Returns list of menu_ids yang berhasil di-recalc.
    """
    from app.services.hpp import recalc_hpp  # noqa: PLC0415

    recipe_rows = (
        client.table("recipes")
        .select("menu_id")
        .eq("ingredient_id", ingredient_id)
        .execute()
        .data
    )

    menu_ids = list({r["menu_id"] for r in recipe_rows})
    if not menu_ids:
        return []

    today        = date.today()
    period_month = date(today.year, today.month, 1)

    recalculated = []
    for menu_id in menu_ids:
        try:
            recalc_hpp(menu_id, period_month, client)
            recalculated.append(menu_id)
        except Exception as exc:
            logger.error("HPP recalc gagal untuk menu %s: %s", menu_id, exc)

    logger.info(
        "HPP recalc triggered: %d menu(s) setelah avg_cost update ingredient %s",
        len(recalculated), ingredient_id,
    )
    return recalculated
