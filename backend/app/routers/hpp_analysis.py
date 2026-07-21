"""
Analisis HPP dengan date range — trend antar periode, perbandingan bulan
sebelumnya, dan dampak perubahan harga ingredient ke seluruh menu.

Semua endpoint read-only (GET), tidak menulis ke DB. Data dibaca dari
menu_hpp (cache HPP per bulan) dan ingredient_cost_history (snapshot
avg_cost per waktu penerimaan barang).
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from app.dependencies import get_current_user
from app.services.supabase import get_supabase_admin
from app.services.yield_calc import get_cumulative_yield

router = APIRouter()

FC_HIGH_THRESHOLD = 40.0
FC_MID_THRESHOLD = 35.0


# ─────────────────────────────────────────────────────────────────────────────
# Helpers — bulan & unit conversion
# ─────────────────────────────────────────────────────────────────────────────

def _first_of_month(d: date) -> date:
    return date(d.year, d.month, 1)


def _add_months(d: date, n: int) -> date:
    """Tambah/kurangi n bulan dari tanggal apa pun (hasil selalu awal bulan)."""
    month_index = d.month - 1 + n
    year = d.year + month_index // 12
    month = month_index % 12 + 1
    return date(year, month, 1)


def _months_between(period_from: date, period_to: date) -> list[date]:
    """Semua first-of-month date dari period_from s.d period_to (inklusif)."""
    months = []
    cur = _first_of_month(period_from)
    end = _first_of_month(period_to)
    while cur <= end:
        months.append(cur)
        cur = _add_months(cur, 1)
    return months


def _end_of_month_ts(period_month: date) -> str:
    """Timestamp awal bulan berikutnya — batas atas untuk query 'as of bulan ini'."""
    return _add_months(period_month, 1).isoformat() + "T00:00:00+00:00"


def _avg_cost_as_of(ingredient_id: str, period_month: date, client) -> Optional[float]:
    """
    Cari avg_cost_snapshot terakhir dari ingredient_cost_history sebelum akhir
    period_month. Kalau belum ada history sama sekali, fallback ke
    ingredients.avg_cost_per_unit (nilai terbaik yang tersedia).
    """
    cutoff = _end_of_month_ts(period_month)
    row = (
        client.table("ingredient_cost_history")
        .select("avg_cost_snapshot")
        .eq("ingredient_id", ingredient_id)
        .lt("received_at", cutoff)
        .order("received_at", desc=True)
        .limit(1)
        .execute()
        .data
    )
    if row:
        return float(row[0]["avg_cost_snapshot"])

    ing = (
        client.table("ingredients")
        .select("avg_cost_per_unit")
        .eq("id", ingredient_id)
        .maybe_single()
        .execute()
        .data
    )
    if ing and ing.get("avg_cost_per_unit") is not None:
        return float(ing["avg_cost_per_unit"])
    return None


def _conversion_factor(
    from_unit: str, to_unit: str, client, cache: Optional[dict] = None
) -> float:
    """factor sehingga qty_in_from_unit × factor = qty_in_to_unit."""
    if from_unit == to_unit:
        return 1.0
    if cache is not None and (from_unit, to_unit) in cache:
        return cache[(from_unit, to_unit)]

    direct = (
        client.table("unit_conversions")
        .select("factor")
        .eq("from_unit_id", from_unit)
        .eq("to_unit_id", to_unit)
        .maybe_single()
        .execute()
        .data
    )
    if direct:
        factor = float(direct["factor"])
    else:
        reverse = (
            client.table("unit_conversions")
            .select("factor")
            .eq("from_unit_id", to_unit)
            .eq("to_unit_id", from_unit)
            .maybe_single()
            .execute()
            .data
        )
        factor = 1.0 / float(reverse["factor"]) if reverse else 1.0

    if cache is not None:
        cache[(from_unit, to_unit)] = factor
    return factor


# ─────────────────────────────────────────────────────────────────────────────
# ENDPOINT 1 — GET /hpp-analysis/summary
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/summary")
def get_hpp_summary(
    period_from: date = Query(..., description="Awal periode (dinormalisasi ke awal bulan)"),
    period_to:   date = Query(..., description="Akhir periode (dinormalisasi ke awal bulan)"),
    division:    str  = Query("all", pattern="^(kitchen|bar|all)$"),
    user=Depends(get_current_user),
):
    """
    Ringkasan food cost % semua menu untuk rentang bulan tertentu, dibandingkan
    dengan 1 bulan sebelum period_from.
    """
    client = get_supabase_admin()

    period_from_norm = _first_of_month(period_from)
    period_to_norm   = _first_of_month(period_to)
    if period_from_norm > period_to_norm:
        raise HTTPException(422, "period_from harus <= period_to")

    months     = _months_between(period_from_norm, period_to_norm)
    prev_month = _add_months(period_from_norm, -1)

    current_rows = (
        client.table("menu_hpp")
        .select(
            "menu_id, period_month, hpp_amount, food_cost_pct,"
            " menu:menu_items!menu_id(name, category, division, selling_price, is_active)"
        )
        .in_("period_month", [m.isoformat() for m in months])
        .execute()
        .data
    )
    prev_rows = (
        client.table("menu_hpp")
        .select("menu_id, food_cost_pct")
        .eq("period_month", prev_month.isoformat())
        .execute()
        .data
    )
    prev_by_menu = {r["menu_id"]: r for r in prev_rows}

    # ── Aggregate current period per menu ────────────────────────────────────
    per_menu: dict[str, dict] = {}
    for r in current_rows:
        menu = r.get("menu") or {}
        if not menu.get("is_active", True):
            continue
        if division != "all" and menu.get("division") != division:
            continue
        selling_price = menu.get("selling_price") or 0
        if selling_price <= 1:
            continue  # harga placeholder — belum diisi admin, skip dari rata-rata
        fc = r.get("food_cost_pct")
        if fc is None:
            continue

        bucket = per_menu.setdefault(r["menu_id"], {
            "menu_id":       r["menu_id"],
            "menu_name":     menu.get("name"),
            "category":      menu.get("category"),
            "division":      menu.get("division"),
            "selling_price": selling_price,
            "hpp_sum":       0.0,
            "fc_sum":        0.0,
            "count":         0,
        })
        bucket["hpp_sum"] += float(r["hpp_amount"] or 0)
        bucket["fc_sum"]  += float(fc)
        bucket["count"]   += 1

    menus_data = []
    for m in per_menu.values():
        avg_hpp = m["hpp_sum"] / m["count"]
        avg_fc  = m["fc_sum"] / m["count"]
        prev    = prev_by_menu.get(m["menu_id"])
        prev_fc = (
            float(prev["food_cost_pct"])
            if prev and prev.get("food_cost_pct") is not None
            else None
        )
        menus_data.append({
            "menu_id":       m["menu_id"],
            "menu_name":     m["menu_name"],
            "category":      m["category"],
            "division":      m["division"],
            "selling_price": m["selling_price"],
            "hpp":           round(avg_hpp, 2),
            "fc_pct":        round(avg_fc, 2),
            "prev_fc_pct":   round(prev_fc, 2) if prev_fc is not None else None,
        })

    total_menus = len(menus_data)
    if total_menus == 0:
        return {
            "period_from":          period_from_norm.isoformat(),
            "period_to":            period_to_norm.isoformat(),
            "total_menus_analyzed": 0,
            "overview":             None,
            "by_category":          [],
            "top_5_highest_fc":     [],
            "top_5_most_improved":  [],
            "top_5_most_worsened":  [],
            "message": (
                "Belum ada data HPP untuk periode ini. Pastikan harga jual sudah "
                "diisi dan jalankan recalculate dari halaman HPP Management."
            ),
        }

    avg_fc_pct = sum(m["fc_pct"] for m in menus_data) / total_menus

    with_prev = [m for m in menus_data if m["prev_fc_pct"] is not None]
    avg_fc_pct_prev = (
        sum(m["prev_fc_pct"] for m in with_prev) / len(with_prev) if with_prev else None
    )
    change_pct = round(avg_fc_pct - avg_fc_pct_prev, 2) if avg_fc_pct_prev is not None else None

    menus_above_40 = sum(1 for m in menus_data if m["fc_pct"] > FC_HIGH_THRESHOLD)
    menus_35_to_40 = sum(1 for m in menus_data if FC_MID_THRESHOLD <= m["fc_pct"] <= FC_HIGH_THRESHOLD)
    menus_below_35 = sum(1 for m in menus_data if m["fc_pct"] < FC_MID_THRESHOLD)

    # ── by_category ───────────────────────────────────────────────────────────
    cats: dict[str, dict] = {}
    for m in menus_data:
        cat = m["category"] or "lainnya"
        c = cats.setdefault(cat, {"fc_sum": 0.0, "count": 0, "prev_sum": 0.0, "prev_count": 0})
        c["fc_sum"] += m["fc_pct"]
        c["count"]  += 1
        if m["prev_fc_pct"] is not None:
            c["prev_sum"]   += m["prev_fc_pct"]
            c["prev_count"] += 1

    by_category = [
        {
            "category":   cat,
            "avg_fc_pct": round(c["fc_sum"] / c["count"], 2),
            "menu_count": c["count"],
            "prev_avg":   round(c["prev_sum"] / c["prev_count"], 2) if c["prev_count"] else None,
        }
        for cat, c in sorted(cats.items(), key=lambda kv: -(kv[1]["fc_sum"] / kv[1]["count"]))
    ]

    # ── top 5s ─────────────────────────────────────────────────────────────────
    top_5_highest_fc = [
        {
            "menu_id":       m["menu_id"],
            "menu_name":     m["menu_name"],
            "hpp":           m["hpp"],
            "selling_price": m["selling_price"],
            "fc_pct":        m["fc_pct"],
            "prev_fc_pct":   m["prev_fc_pct"],
        }
        for m in sorted(menus_data, key=lambda x: -x["fc_pct"])[:5]
    ]

    changed = [
        {**m, "change": round(m["fc_pct"] - m["prev_fc_pct"], 2)}
        for m in menus_data if m["prev_fc_pct"] is not None
    ]
    top_5_most_improved = sorted(changed, key=lambda x: x["change"])[:5]
    top_5_most_worsened = sorted(changed, key=lambda x: -x["change"])[:5]

    return {
        "period_from":          period_from_norm.isoformat(),
        "period_to":            period_to_norm.isoformat(),
        "total_menus_analyzed": total_menus,
        "overview": {
            "avg_food_cost_pct":              round(avg_fc_pct, 2),
            "avg_food_cost_pct_prev_period":  round(avg_fc_pct_prev, 2) if avg_fc_pct_prev is not None else None,
            "change_pct":                     change_pct,
            "menus_above_40":                 menus_above_40,
            "menus_35_to_40":                 menus_35_to_40,
            "menus_below_35":                 menus_below_35,
        },
        "by_category":         by_category,
        "top_5_highest_fc":    top_5_highest_fc,
        "top_5_most_improved": top_5_most_improved,
        "top_5_most_worsened": top_5_most_worsened,
    }


# ─────────────────────────────────────────────────────────────────────────────
# ENDPOINT 2 — GET /hpp-analysis/menu/{menu_id}/trend
# ─────────────────────────────────────────────────────────────────────────────

def _ingredient_breakdown(
    menu_id: str, current_period: date, prev_period: date, client
) -> list[dict]:
    """
    Breakdown kontribusi tiap ingredient ke HPP menu pada current_period,
    dibandingkan dengan cost-nya pada prev_period.
    """
    recipes = (
        client.table("recipes")
        .select(
            "ingredient_id, qty, unit_id,"
            " unit:units!unit_id(symbol),"
            " ingredients(name, ingredient_type, base_unit_id)"
        )
        .eq("menu_id", menu_id)
        .execute()
        .data
    )
    if not recipes:
        return []

    processed_ids = [
        r["ingredient_id"] for r in recipes
        if (r.get("ingredients") or {}).get("ingredient_type") == "processed"
    ]
    process_map: dict[str, str] = {}
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

    conv_cache: dict[tuple[str, str], float] = {}
    rows: list[dict] = []
    total_cost = 0.0

    for r in recipes:
        ing      = r.get("ingredients") or {}
        ing_type = ing.get("ingredient_type", "raw")
        if ing_type == "packaging":
            continue

        ing_id      = r["ingredient_id"]
        ing_name    = ing.get("name", ing_id)
        recipe_unit = r.get("unit_id")
        base_unit   = ing.get("base_unit_id")
        unit_symbol = (r.get("unit") or {}).get("symbol", "")
        qty         = float(r["qty"])

        factor = (
            _conversion_factor(recipe_unit, base_unit, client, conv_cache)
            if (recipe_unit and base_unit) else 1.0
        )
        qty_base = qty * factor

        cost_current = _avg_cost_as_of(ing_id, current_period, client)
        cost_prev    = _avg_cost_as_of(ing_id, prev_period, client)

        if ing_type == "processed":
            process_id = process_map.get(ing_id)
            cum_yield  = get_cumulative_yield(process_id, client) if process_id else 1.0
            cum_yield  = cum_yield or 1.0
        else:
            cum_yield = 1.0

        eff_current = (cost_current / cum_yield) if cost_current is not None else None
        eff_prev    = (cost_prev / cum_yield) if cost_prev is not None else None

        cost            = (qty_base * eff_current) if eff_current is not None else 0.0
        cost_prev_total = (qty_base * eff_prev) if eff_prev is not None else None

        change_pct = None
        if cost_prev_total is not None and cost_prev_total > 0:
            change_pct = round((cost - cost_prev_total) / cost_prev_total * 100, 2)

        total_cost += cost
        rows.append({
            "ingredient":      ing_name,
            "qty":             qty,
            "unit":            unit_symbol,
            "cost":            round(cost, 2),
            "cost_prev_month": round(cost_prev_total, 2) if cost_prev_total is not None else None,
            "change_pct":      change_pct,
        })

    for row in rows:
        row["pct_of_hpp"] = round((row["cost"] / total_cost * 100), 2) if total_cost > 0 else 0.0

    rows.sort(key=lambda r: -r["pct_of_hpp"])
    return rows


@router.get("/menu/{menu_id}/trend")
def get_menu_hpp_trend(
    menu_id: str,
    months: int = Query(6, ge=1, le=24, description="Berapa bulan ke belakang"),
    user=Depends(get_current_user),
):
    """
    Trend HPP & food cost % untuk 1 menu selama N bulan terakhir, plus
    breakdown kontribusi tiap ingredient ke HPP periode terbaru.
    """
    client = get_supabase_admin()

    menu = (
        client.table("menu_items")
        .select("id, name, selling_price, category, division")
        .eq("id", menu_id)
        .maybe_single()
        .execute()
        .data
    )
    if not menu:
        raise HTTPException(404, "Menu tidak ditemukan")

    today         = date.today()
    current_month = _first_of_month(today)
    start_month   = _add_months(current_month, -(months - 1))

    hpp_rows = (
        client.table("menu_hpp")
        .select("period_month, hpp_amount, food_cost_pct")
        .eq("menu_id", menu_id)
        .gte("period_month", start_month.isoformat())
        .lte("period_month", current_month.isoformat())
        .order("period_month")
        .execute()
        .data
    )

    trend = [
        {
            "period": r["period_month"][:7],
            "hpp":    float(r["hpp_amount"]),
            "fc_pct": float(r["food_cost_pct"]) if r["food_cost_pct"] is not None else None,
        }
        for r in hpp_rows
    ]

    if not trend:
        return {
            "menu_id":                     menu_id,
            "menu_name":                   menu["name"],
            "selling_price":               float(menu["selling_price"] or 0),
            "trend":                       [],
            "ingredient_breakdown_current": [],
            "biggest_cost_driver":         None,
            "message": (
                "Belum ada data HPP untuk menu ini. Pastikan harga jual sudah diisi "
                "dan jalankan recalculate dari halaman HPP Management."
            ),
        }

    current_period_month = date.fromisoformat(hpp_rows[-1]["period_month"])
    prev_period_month     = _add_months(current_period_month, -1)

    breakdown = _ingredient_breakdown(menu_id, current_period_month, prev_period_month, client)

    biggest = None
    if breakdown:
        top     = breakdown[0]  # sudah di-sort desc by pct_of_hpp
        insight = f"Menyumbang {top['pct_of_hpp']:.1f}% dari total HPP menu ini."
        if top.get("change_pct") is not None:
            arah    = "naik" if top["change_pct"] > 0 else "turun"
            insight += f" Harga {arah} {abs(top['change_pct']):.1f}% dari bulan lalu."
        biggest = {
            "ingredient":        top["ingredient"],
            "contribution_pct":  top["pct_of_hpp"],
            "insight":           insight,
        }

    return {
        "menu_id":                     menu_id,
        "menu_name":                   menu["name"],
        "selling_price":               float(menu["selling_price"] or 0),
        "trend":                       trend,
        "ingredient_breakdown_current": breakdown,
        "biggest_cost_driver":         biggest,
    }


# ─────────────────────────────────────────────────────────────────────────────
# ENDPOINT 3 — GET /hpp-analysis/ingredient-impact
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/ingredient-impact")
def get_ingredient_impact(
    period_month: date = Query(..., description="Bulan yang dianalisis (dinormalisasi ke awal bulan)"),
    division:     str  = Query("all", pattern="^(kitchen|bar|all)$"),
    user=Depends(get_current_user),
):
    """
    Ranking ingredient berdasarkan seberapa besar perubahan harganya
    berdampak ke total HPP semua menu yang memakainya.
    """
    client = get_supabase_admin()
    period_month_norm = _first_of_month(period_month)
    prev_month         = _add_months(period_month_norm, -1)

    ing_q = client.table("ingredients").select("id, name, division").eq("is_active", True)
    if division != "all":
        ing_q = ing_q.in_("division", [division, "both"])
    ingredients = ing_q.execute().data or []

    all_recipes = (
        client.table("recipes")
        .select(
            "ingredient_id, qty, unit_id,"
            " menu:menu_items!menu_id(name, is_active, division),"
            " ingredients(base_unit_id)"
        )
        .execute()
        .data
    )
    recipes_by_ing: dict[str, list[dict]] = defaultdict(list)
    for r in all_recipes:
        recipes_by_ing[r["ingredient_id"]].append(r)

    conv_cache: dict[tuple[str, str], float] = {}
    results = []

    for ing in ingredients:
        ing_id = ing["id"]
        cost_current = _avg_cost_as_of(ing_id, period_month_norm, client)
        cost_prev    = _avg_cost_as_of(ing_id, prev_month, client)
        if cost_current is None or cost_prev is None or cost_prev == 0:
            continue

        price_change_pct = round((cost_current - cost_prev) / cost_prev * 100, 2)

        affected_names: list[str] = []
        total_qty_base = 0.0
        for r in recipes_by_ing.get(ing_id, []):
            menu = r.get("menu") or {}
            if not menu.get("is_active", True):
                continue
            if division != "all" and menu.get("division") != division:
                continue
            ing_base    = (r.get("ingredients") or {}).get("base_unit_id")
            recipe_unit = r.get("unit_id")
            factor = (
                _conversion_factor(recipe_unit, ing_base, client, conv_cache)
                if (recipe_unit and ing_base) else 1.0
            )
            total_qty_base += float(r["qty"]) * factor
            affected_names.append(menu.get("name"))

        if not affected_names:
            continue

        total_hpp_impact = round((cost_current - cost_prev) * total_qty_base, 2)
        abs_change = abs(price_change_pct)
        severity = "high" if abs_change > 10 else ("medium" if abs_change >= 5 else "low")

        results.append({
            "ingredient_id":       ing_id,
            "ingredient_name":     ing["name"],
            "avg_cost_current":    round(cost_current, 2),
            "avg_cost_prev_month": round(cost_prev, 2),
            "price_change_pct":    price_change_pct,
            "menus_affected":      len(affected_names),
            "affected_menu_names": affected_names,
            "total_hpp_impact":    total_hpp_impact,
            "severity":            severity,
        })

    results.sort(key=lambda r: -abs(r["total_hpp_impact"]))

    return {
        "period":      period_month_norm.isoformat()[:7],
        "ingredients": results,
    }
