"""
Dashboard summary — KPI cards untuk owner dan admin.

Semua kalkulasi di Python (bukan SQL), Supabase hanya sebagai data source.
Query order per section:
  1. variance_today     → variance_reports (date=today)
  2. food_cost_month    → menu_hpp JOIN menu_items (period=this month)
  3. spending_month     → goods_receipts (this month) JOIN po.po_category → receipt_items total
  4. production_today   → production_batches (date=today)
  5. recent_po          → purchase_orders JOIN vendors + po_items (month, last 5)

spending_month aggregate by po_category (kitchen/bar/staff_meal/operational).
Receipts tanpa po_id (emergency purchase) di-fallback ke category='kitchen'.
"""
import logging
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, Query
from app.dependencies import require_owner
from app.services.supabase import get_supabase_admin
from app.services.stock_level import get_current_stock

logger = logging.getLogger(__name__)
router = APIRouter()


# ── Helpers ───────────────────────────────────────────────────────────────────

def _month_start(d: date) -> date:
    return date(d.year, d.month, 1)


def _safe_float(val, default=0.0) -> float:
    try:
        return float(val) if val is not None else default
    except (TypeError, ValueError):
        return default


# ── Endpoint ──────────────────────────────────────────────────────────────────

@router.get("/summary")
def dashboard_summary(user=Depends(require_owner)):
    client       = get_supabase_admin()
    today        = date.today()
    today_str    = today.isoformat()
    month_start  = _month_start(today)
    month_str    = month_start.isoformat()   # "2026-06-01" — used as period_month key
    period_label = f"{today.year}-{today.month:02d}"  # "2026-06" — human-readable

    # ── 1. Variance hari ini ───────────────────────────────────
    # Fetch semua rows hari ini sekaligus (max ~160 ingredient)
    var_rows = (
        client.table("variance_reports")
        .select(
            "variance_pct, is_flagged,"
            "ingredient:ingredients!ingredient_id(name, division)"
        )
        .eq("report_date", today_str)
        .execute()
        .data
    ) or []

    flagged_count = sum(1 for r in var_rows if r.get("is_flagged"))

    # Build list dengan variance_pct, lalu sort abs desc → ambil 5 terburuk
    var_detail = []
    for r in var_rows:
        pct = _safe_float(r.get("variance_pct"))
        ing = r.get("ingredient") or {}
        var_detail.append({
            "ingredient":   ing.get("name", "?"),
            "variance_pct": round(pct, 2),
            "division":     ing.get("division", "?"),
        })
    worst_5 = sorted(var_detail, key=lambda x: abs(x["variance_pct"]), reverse=True)[:5]

    # ── 2. Food cost bulan ini ─────────────────────────────────
    # menu_hpp JOIN menu_items untuk dapat division dan nama menu
    hpp_rows = (
        client.table("menu_hpp")
        .select(
            "food_cost_pct,"
            "menu:menu_items!menu_id(name, division)"
        )
        .eq("period_month", month_str)
        .execute()
        .data
    ) or []

    kitchen_pcts: list[float] = []
    bar_pcts:     list[float] = []
    items_above_40 = 0
    best_menu  = None
    worst_menu = None

    for r in hpp_rows:
        raw_fc = r.get("food_cost_pct")
        if raw_fc is None:
            continue

        fc = float(raw_fc)
        menu   = r.get("menu") or {}
        name   = menu.get("name", "?")
        div    = menu.get("division", "")
        entry  = {"name": name, "fc_pct": round(fc, 1)}

        if div == "kitchen":
            kitchen_pcts.append(fc)
        elif div == "bar":
            bar_pcts.append(fc)

        if fc > 40:
            items_above_40 += 1

        if best_menu is None or fc < best_menu["fc_pct"]:
            best_menu = entry
        if worst_menu is None or fc > worst_menu["fc_pct"]:
            worst_menu = entry

    kitchen_avg_pct = (
        round(sum(kitchen_pcts) / len(kitchen_pcts), 1) if kitchen_pcts else None
    )
    bar_avg_pct = (
        round(sum(bar_pcts) / len(bar_pcts), 1) if bar_pcts else None
    )

    # ── 3. Spending bulan ini ──────────────────────────────────
    # Step A: ambil goods_receipts bulan ini + po_category dari linked PO (fallback lama)
    receipt_rows = (
        client.table("goods_receipts")
        .select("id, po:purchase_orders!po_id(po_category)")
        .gte("received_date", month_str)
        .lte("received_date", today_str)
        .execute()
        .data
    ) or []

    # Map receipt_id → po_category dari PO; dipakai sebagai fallback untuk item lama
    receipt_po_category: dict[str, str] = {}
    for r in receipt_rows:
        po  = r.get("po") or {}
        cat = po.get("po_category") or "kitchen"
        receipt_po_category[r["id"]] = cat

    receipt_ids = list(receipt_po_category.keys())
    spending: dict[str, float] = {
        "storage_bar":     0.0,
        "storage_kitchen": 0.0,
        "kitchen":         0.0,
        "bar":             0.0,
        "staff_meal":      0.0,
        "operational":     0.0,
    }

    if receipt_ids:
        # Step B: receipt_items dengan po_category per-item (quick-entry)
        # Prioritas: item.po_category → receipt's PO.po_category → 'kitchen'
        items = (
            client.table("receipt_items")
            .select("receipt_id, total_price, po_category")
            .in_("receipt_id", receipt_ids)
            .execute()
            .data
        ) or []

        for item in items:
            # Gunakan po_category dari item jika ada (quick-entry),
            # jika tidak fallback ke po_category dari linked PO (PO formal lama)
            cat = item.get("po_category") or receipt_po_category.get(item["receipt_id"], "kitchen")
            amt = _safe_float(item.get("total_price"))
            spending[cat] = spending.get(cat, 0.0) + amt

    spending_total = sum(spending.values())

    # ── 4. Production hari ini ────────────────────────────────
    prod_res = (
        client.table("production_batches")
        .select("is_flagged", count="exact")
        .eq("batch_date", today_str)
        .execute()
    )
    prod_data     = prod_res.data or []
    prod_batches  = prod_res.count or 0
    prod_flagged  = sum(1 for r in prod_data if r.get("is_flagged"))

    # ── 4b. Revenue hari ini (hanya entry_type='sale') ───────
    sales_rows = (
        client.table("daily_sales_entries")
        .select("menu_id, qty_sold, entry_type")
        .eq("entry_date", today_str)
        .gt("qty_sold", 0)
        .execute()
        .data
    ) or []

    sale_menu_ids = list({e["menu_id"] for e in sales_rows if e.get("entry_type", "sale") == "sale"})
    revenue_today = 0.0
    complimentary_cost_today = 0.0

    if sales_rows:
        all_menu_ids = list({e["menu_id"] for e in sales_rows})
        menu_prices_res = (
            client.table("menu_items")
            .select("id, selling_price")
            .in_("id", all_menu_ids)
            .execute()
            .data
        ) or []
        price_map = {m["id"]: _safe_float(m.get("selling_price")) for m in menu_prices_res}
        for e in sales_rows:
            mid = e["menu_id"]
            qty = int(e.get("qty_sold", 0))
            et  = e.get("entry_type", "sale")
            val = qty * price_map.get(mid, 0.0)
            if et == "sale":
                revenue_today += val
            elif et == "complimentary":
                complimentary_cost_today += val

    # Complimentary cost bulan ini (selling_price × qty — sebagai opportunity cost)
    comp_rows = (
        client.table("daily_sales_entries")
        .select("menu_id, qty_sold")
        .gte("entry_date", month_str)
        .lte("entry_date", today_str)
        .eq("entry_type", "complimentary")
        .gt("qty_sold", 0)
        .execute()
        .data
    ) or []

    complimentary_cost_month = 0.0
    if comp_rows:
        comp_menu_ids = list({e["menu_id"] for e in comp_rows})
        comp_prices = (
            client.table("menu_items")
            .select("id, selling_price")
            .in_("id", comp_menu_ids)
            .execute()
            .data
        ) or []
        comp_price_map = {m["id"]: _safe_float(m.get("selling_price")) for m in comp_prices}
        complimentary_cost_month = sum(
            int(e["qty_sold"]) * comp_price_map.get(e["menu_id"], 0.0)
            for e in comp_rows
        )

    # ── 5. PO terbaru bulan ini (max 5) ───────────────────────
    po_rows = (
        client.table("purchase_orders")
        .select(
            "po_number, status, po_date,"
            "vendor:vendors!vendor_id(name),"
            "items:po_items(total_price)"
        )
        .gte("po_date", month_str)
        .order("po_date",    desc=True)
        .order("created_at", desc=True)
        .limit(5)
        .execute()
        .data
    ) or []

    recent_po = [
        {
            "po_number": r["po_number"],
            "vendor":    (r.get("vendor") or {}).get("name", "?"),
            "status":    r["status"],
            "total":     round(
                sum(_safe_float(it.get("total_price")) for it in (r.get("items") or []))
            ),
        }
        for r in po_rows
    ]

    # ── 5b. Low stock (Section C) ─────────────────────────────
    try:
        stock_data = get_current_stock(client=client)
        low_stock_items = [s for s in stock_data if s["is_critical"] or s["is_low"]]
        low_stock_count = len(low_stock_items)
        low_stock_preview = [
            {
                "ingredient_name": s["ingredient_name"],
                "division":        s["division"],
                "current_stock":   s["division_stock"],
                "min_threshold":   s["min_threshold"],
                "unit_symbol":     s["unit_symbol"],
                "is_critical":     s["is_critical"],
            }
            for s in low_stock_items[:5]
        ]
    except Exception:
        low_stock_count   = 0
        low_stock_preview = []

    # ── Assemble ─────────────────────────────────────────────
    return {
        "date": today_str,
        "variance_today": {
            "total_ingredients_checked": len(var_rows),
            "flagged_count":             flagged_count,
            "worst_5":                   worst_5,
        },
        "food_cost_month": {
            "period":          period_label,
            "kitchen_avg_pct": kitchen_avg_pct,
            "bar_avg_pct":     bar_avg_pct,
            "items_above_40":  items_above_40,
            "best_menu":       best_menu,
            "worst_menu":      worst_menu,
        },
        "spending_month": {
            **{k: round(v) for k, v in spending.items()},
            "total": round(spending_total),
        },
        "production_today": {
            "batches": prod_batches,
            "flagged": prod_flagged,
        },
        "sales_today": {
            "revenue":              round(revenue_today),
            "complimentary_cost":   round(complimentary_cost_today),
        },
        "complimentary_cost_month": round(complimentary_cost_month),
        "low_stock": {
            "count":   low_stock_count,
            "items":   low_stock_preview,
        },
        "recent_po": recent_po,
    }


PURCHASE_CATEGORIES = ["storage_bar", "storage_kitchen", "kitchen", "bar", "staff_meal", "operational"]


@router.get("/purchases")
def purchases_recap(
    range: str = Query("daily", description="daily | weekly | monthly | custom"),
    target_date: Optional[date] = Query(None, alias="date", description="YYYY-MM-DD, default hari ini"),
    custom_from: Optional[date] = Query(None, alias="from", description="custom: tanggal awal"),
    custom_to:   Optional[date] = Query(None, alias="to", description="custom: tanggal akhir"),
    user=Depends(require_owner),
):
    """
    Rekap total belanja per kategori/lokasi + grand total untuk range terpilih.

    - daily   → tanggal itu saja
    - weekly  → Senin s/d Minggu di minggu tanggal itu
    - monthly → bulan tanggal itu
    - custom  → from s/d to (wajib dua-duanya)

    Query dari goods_receipts + receipt_items yang sudah ada (READ ONLY).
    Initial stock (is_initial_stock=true) di-exclude — bukan belanja.
    """
    from datetime import timedelta
    from fastapi import HTTPException

    if range not in ("daily", "weekly", "monthly", "custom"):
        raise HTTPException(422, "range harus daily | weekly | monthly | custom")

    d = target_date or date.today()
    if range == "daily":
        date_from, date_to = d, d
    elif range == "weekly":
        date_from = d - timedelta(days=d.weekday())
        date_to   = date_from + timedelta(days=6)
    elif range == "monthly":
        date_from = date(d.year, d.month, 1)
        date_to   = (date(d.year + 1, 1, 1) if d.month == 12 else date(d.year, d.month + 1, 1)) - timedelta(days=1)
    else:
        if not custom_from or not custom_to:
            raise HTTPException(422, "range=custom butuh parameter from & to")
        if custom_from > custom_to:
            raise HTTPException(422, "tanggal awal harus <= tanggal akhir")
        date_from, date_to = custom_from, custom_to

    client = get_supabase_admin()
    receipts = (
        client.table("goods_receipts")
        .select("id, is_initial_stock")
        .gte("received_date", date_from.isoformat())
        .lte("received_date", date_to.isoformat())
        .execute()
        .data
    ) or []
    receipt_ids = [r["id"] for r in receipts if not r.get("is_initial_stock")]

    by_category = {c: 0.0 for c in PURCHASE_CATEGORIES}
    if receipt_ids:
        items = (
            client.table("receipt_items")
            .select("receipt_id, total_price, po_category")
            .in_("receipt_id", receipt_ids)
            .execute()
            .data
        ) or []
        for it in items:
            cat = it.get("po_category") or "kitchen"  # item lama tanpa kategori → kitchen
            by_category[cat] = by_category.get(cat, 0.0) + _safe_float(it.get("total_price"))

    return {
        "range":       range,
        "date_from":   date_from.isoformat(),
        "date_to":     date_to.isoformat(),
        "by_category": {k: round(v) for k, v in by_category.items()},
        "total":       round(sum(by_category.values())),
    }


@router.get("/daily-sales")
def daily_sales(
    date: Optional[str] = Query(None, description="YYYY-MM-DD, default hari ini"),
    user=Depends(require_owner),
):
    """
    Ringkasan penjualan untuk satu hari:
    - Total revenue (hanya sale), porsi, menu count
    - Perbandingan vs kemarin
    - Top 5 menu terjual
    - Revenue by category
    """
    from datetime import date as date_type, timedelta
    client = get_supabase_admin()

    today = date_type.fromisoformat(date) if date else date_type.today()
    yesterday = today - timedelta(days=1)

    def _fetch_day(d: date_type):
        rows = (
            client.table("daily_sales_entries")
            .select("menu_id, qty_sold, entry_type, menu:menu_items!menu_id(name, selling_price, category)")
            .eq("entry_date", d.isoformat())
            .gt("qty_sold", 0)
            .execute()
            .data
        ) or []
        return rows

    def _aggregate(rows):
        revenue = 0.0
        porsi = 0
        by_menu: dict[str, dict] = {}
        by_category: dict[str, float] = {}

        for e in rows:
            menu = e.get("menu") or {}
            mid  = e["menu_id"]
            qty  = int(e["qty_sold"])
            et   = e.get("entry_type", "sale")
            price = _safe_float(menu.get("selling_price"))
            cat   = menu.get("category") or "other"
            val   = qty * price

            if et == "sale":
                revenue += val
                porsi   += qty
                by_category[cat] = by_category.get(cat, 0.0) + val
                if mid not in by_menu:
                    by_menu[mid] = {"menu_id": mid, "name": menu.get("name", "?"), "qty": 0, "revenue": 0.0, "category": cat}
                by_menu[mid]["qty"]     += qty
                by_menu[mid]["revenue"] += val

        top5 = sorted(by_menu.values(), key=lambda x: x["qty"], reverse=True)[:5]
        cat_breakdown = [{"category": k, "revenue": round(v)} for k, v in
                         sorted(by_category.items(), key=lambda x: x[1], reverse=True)]
        return {
            "revenue": round(revenue),
            "porsi":   porsi,
            "menu_count": len(by_menu),
            "top5": top5,
            "by_category": cat_breakdown,
        }

    today_data = _aggregate(_fetch_day(today))
    yest_data  = _aggregate(_fetch_day(yesterday))

    def _delta(a, b):
        if b == 0:
            return None
        return round((a - b) / b * 100, 1)

    return {
        "date":          today.isoformat(),
        "yesterday":     yesterday.isoformat(),
        **today_data,
        "comparison_vs_yesterday": {
            "revenue_delta_pct": _delta(today_data["revenue"], yest_data["revenue"]),
            "porsi_delta_pct":   _delta(today_data["porsi"],   yest_data["porsi"]),
            "yesterday_revenue": yest_data["revenue"],
            "yesterday_porsi":   yest_data["porsi"],
        },
    }


@router.get("/low-stock")
def low_stock(
    division: Optional[str] = Query(None),
    critical_only: bool = Query(False),
    user=Depends(require_owner),
):
    """Semua ingredient yang stok di bawah min_threshold (kritis) atau 1.5× threshold (rendah)."""
    all_stock = get_current_stock()
    result = [s for s in all_stock if s["is_critical"] or s["is_low"]]
    if division:
        result = [s for s in result if s["division"] == division]
    if critical_only:
        result = [s for s in result if s["is_critical"]]
    return result


@router.get("/food-cost-top")
def food_cost_top(
    limit:    int           = Query(10, ge=1, le=200),
    division: Optional[str] = Query(None),
    user = Depends(require_owner),
):
    """
    Menu dengan food cost tertinggi bulan ini, sorted DESC.

    - limit=10  → untuk Chart 2 (top 10 per menu)
    - limit=200 → untuk Chart 1 (semua menu, di-group by category di frontend)
    - division  → filter optional: 'kitchen' | 'bar' (default: semua)

    Fetch max 200 dari DB, filter division di Python, potong sesuai limit.
    Tidak N+1: 1 query dengan nested select.
    """
    client    = get_supabase_admin()
    month_str = _month_start(date.today()).isoformat()

    rows = (
        client.table("menu_hpp")
        .select(
            "food_cost_pct, hpp_amount,"
            "menu:menu_items!menu_id(name, category, division, selling_price)"
        )
        .eq("period_month", month_str)
        .not_.is_("food_cost_pct", "null")
        .order("food_cost_pct", desc=True)
        .limit(200)     # fetch semua, filter Python-side
        .execute()
        .data
    ) or []

    result = []
    for r in rows:
        menu = r.get("menu") or {}
        div  = menu.get("division") or ""
        if division and division != "all" and div != division:
            continue
        result.append({
            "menu_name":     menu.get("name", "?"),
            "category":      menu.get("category") or "other",
            "division":      div,
            "selling_price": float(menu.get("selling_price") or 0),
            "hpp_amount":    _safe_float(r.get("hpp_amount")),
            "food_cost_pct": round(_safe_float(r.get("food_cost_pct")), 1),
        })
        if len(result) >= limit:
            break

    return result
