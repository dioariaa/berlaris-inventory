"""
Endpoint kalkulasi manual — dipanggil oleh admin untuk trigger recalc
tanpa harus submit ulang data operasional.

Berguna untuk:
- Recalc setelah koreksi resep / BOM
- Debugging variance
- Re-sync setelah migrasi data
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, field_validator
from datetime import date
from decimal import Decimal
from typing import Optional

from app.dependencies import require_admin, get_current_user
from app.services.supabase import get_supabase_admin
from app.services.consumption import calculate_theoretical_consumption
from app.services.variance import calculate_variance
from app.services.hpp import recalc_hpp, recalc_all_hpp
from app.services.avg_cost import update_avg_cost

router = APIRouter()


class AvgCostUpdate(BaseModel):
    new_qty:            Decimal
    new_price_per_unit: Decimal
    unit_id:            str
    receipt_item_id:    Optional[str] = None

    @field_validator("new_qty")
    @classmethod
    def qty_positive(cls, v: Decimal) -> Decimal:
        if v <= 0:
            raise ValueError("new_qty harus > 0")
        return v

    @field_validator("new_price_per_unit")
    @classmethod
    def price_non_negative(cls, v: Decimal) -> Decimal:
        if v < 0:
            raise ValueError("new_price_per_unit tidak boleh negatif")
        return v


@router.get("/variance")
def read_variance_reports(
    date_from:   Optional[date] = Query(None),
    date_to:     Optional[date] = Query(None),
    flagged_only: bool          = Query(False, alias="flagged"),
    division:    Optional[str]  = Query(None),
    ingredient_id: Optional[str] = Query(None),
    limit:       int            = Query(100, ge=1, le=500),
    offset:      int            = Query(0, ge=0),
    user=Depends(get_current_user),
):
    """
    Baca laporan variance dari variance_reports table.
    Filter: tanggal, flagged, divisi, ingredient.
    Dipakai oleh halaman Variance Report di frontend.
    """
    client = get_supabase_admin()

    q = (
        client.table("variance_reports")
        .select(
            "id, report_date, ingredient_id, opening_qty, production_in_qty,"
            " theoretical_out_qty, theoretical_closing, actual_closing_qty,"
            " variance_qty, variance_pct, is_flagged, calculated_at,"
            " ingredient:ingredients!ingredient_id(name, division, ingredient_type,"
            "   unit:units!base_unit_id(symbol))",
            count="exact",
        )
    )

    if date_from:
        q = q.gte("report_date", date_from.isoformat())
    if date_to:
        q = q.lte("report_date", date_to.isoformat())
    if flagged_only:
        q = q.eq("is_flagged", True)
    if ingredient_id:
        q = q.eq("ingredient_id", ingredient_id)

    res = q.order("report_date", desc=True).order("is_flagged", desc=True).range(offset, offset + limit - 1).execute()

    rows = []
    for r in res.data:
        ing = r.pop("ingredient", None) or {}
        unit = ing.pop("unit", None) or {}
        rows.append({
            **r,
            "ingredient_name": ing.get("name"),
            "division":        ing.get("division"),
            "ingredient_type": ing.get("ingredient_type"),
            "unit_symbol":     unit.get("symbol"),
        })

    # Post-filter by division (join field, can't filter in Supabase query directly on nested)
    if division:
        rows = [r for r in rows if r.get("division") == division]

    return {
        "total":  res.count,
        "offset": offset,
        "limit":  limit,
        "data":   rows,
    }


@router.get("/hpp")
def read_hpp_cache(
    period_month: Optional[date] = Query(None, alias="month", description="YYYY-MM-DD (first day). Default: bulan ini"),
    user=Depends(get_current_user),
):
    """
    Baca HPP yang sudah di-cache dari menu_hpp (tanpa recalculate).
    Dipakai frontend untuk live preview food cost.
    Returns: list of {menu_id, menu_name, selling_price, category, hpp_amount, food_cost_pct}
    """
    client = get_supabase_admin()
    if period_month is None:
        today = date.today()
        period_month = date(today.year, today.month, 1)

    rows = (
        client.table("menu_hpp")
        .select(
            "menu_id, period_month, hpp_amount, food_cost_pct,"
            " menu:menu_items!menu_id(name, selling_price, category, division)"
        )
        .eq("period_month", period_month.isoformat())
        .execute()
        .data
    )

    return [
        {
            "menu_id":      r["menu_id"],
            "menu_name":    (r.get("menu") or {}).get("name"),
            "selling_price": (r.get("menu") or {}).get("selling_price"),
            "category":     (r.get("menu") or {}).get("category"),
            "division":     (r.get("menu") or {}).get("division"),
            "period_month": r["period_month"],
            "hpp_amount":   r["hpp_amount"],
            "food_cost_pct": r["food_cost_pct"],
        }
        for r in rows
    ]


@router.post("/theoretical-consumption")
def recalc_theoretical_consumption(
    target_date: date = Query(..., alias="date", description="Tanggal yang akan di-recalc (YYYY-MM-DD)"),
    user=Depends(require_admin),
):
    """
    Recalculate theoretical_consumption untuk tanggal tertentu.

    Membaca ulang daily_sales_entries × BOM dari DB.
    Idempotent: aman dipanggil berulang kali.
    """
    client = get_supabase_admin()
    try:
        count = calculate_theoretical_consumption(target_date, client)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Kalkulasi gagal: {exc}") from exc

    return {
        "date": target_date.isoformat(),
        "ingredients_updated": count,
        "message": (
            f"{count} ingredient records di-upsert untuk {target_date.isoformat()}"
            if count > 0
            else f"Tidak ada penjualan pada {target_date.isoformat()} — theoretical_consumption dibersihkan"
        ),
    }


@router.post("/variance")
def recalc_variance(
    target_date: date = Query(..., alias="date", description="Tanggal variance (YYYY-MM-DD)"),
    user=Depends(require_admin),
):
    """
    Recalculate variance untuk tanggal tertentu.

    Hanya ingredient yang sudah di-opname pada tanggal tersebut yang dikalkulasi.
    Idempotent: aman dipanggil berulang kali.
    """
    client = get_supabase_admin()
    try:
        results = calculate_variance(target_date, client)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Kalkulasi gagal: {exc}") from exc

    flagged = sum(1 for r in results if r["is_flagged"])
    return {
        "date": target_date.isoformat(),
        "ingredients_calculated": len(results),
        "flagged": flagged,
        "message": f"{len(results)} ingredient dikalkulasi, {flagged} di-flag (|variance| > {5.0}%)",
    }


@router.post("/hpp")
def recalc_hpp_endpoint(
    menu_id:      Optional[str]  = Query(None, description="UUID menu. Kosong = recalc semua menu aktif"),
    period_month: Optional[date] = Query(None, alias="month", description="YYYY-MM-DD (first day of month). Default: bulan ini"),
    user=Depends(require_admin),
):
    """
    Recalculate HPP untuk satu menu atau semua menu aktif.

    - Dengan `menu_id`: recalc satu menu untuk period_month.
    - Tanpa `menu_id`: recalc semua menu aktif (bulk).

    Idempotent: aman dipanggil berulang kali.
    """
    client = get_supabase_admin()

    if period_month:
        period_month = date(period_month.year, period_month.month, 1)

    try:
        if menu_id:
            result = recalc_hpp(menu_id, period_month, client)
            return {
                "menus_calculated": 1,
                "period_month": result["period_month"],
                "results": [result],
            }
        else:
            results = recalc_all_hpp(period_month, client)
            return {
                "menus_calculated": len(results),
                "period_month": results[0]["period_month"] if results else None,
                "results": results,
            }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"HPP recalc gagal: {exc}") from exc


@router.post("/avg-cost/{ingredient_id}")
def recalc_avg_cost(
    ingredient_id: str,
    body: AvgCostUpdate,
    user=Depends(require_admin),
):
    """
    Update weighted average cost untuk satu ingredient setelah goods receipt.

    Secara otomatis:
    - Konversi qty/harga ke base_unit ingredient
    - Hitung weighted average dari seluruh history
    - Update ingredients.avg_cost_per_unit
    - Insert ke ingredient_cost_history
    - Trigger HPP recalc untuk semua menu yang pakai ingredient ini

    Biasanya dipanggil internal oleh goods_receipts router saat receipt dikonfirmasi.
    """
    client = get_supabase_admin()
    try:
        result = update_avg_cost(
            ingredient_id=ingredient_id,
            new_qty=float(body.new_qty),
            new_price_per_unit=float(body.new_price_per_unit),
            unit_id=body.unit_id,
            receipt_item_id=body.receipt_item_id,
            client=client,
        )
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Update avg_cost gagal: {exc}") from exc

    return {
        "ingredient_id":      result["ingredient_id"],
        "ingredient_name":    result["ingredient_name"],
        "old_avg_cost":       result["old_avg_cost"],
        "new_avg_cost":       result["new_avg_cost"],
        "menus_recalculated": len(result["menus_recalculated"]),
        "menu_ids":           result["menus_recalculated"],
        "message": (
            f"avg_cost '{result['ingredient_name']}' diupdate: "
            f"Rp {result['old_avg_cost']:,.0f} → Rp {result['new_avg_cost']:,.0f}/base_unit. "
            f"{len(result['menus_recalculated'])} menu HPP di-recalc."
        ),
    }
