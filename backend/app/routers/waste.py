from datetime import date, timedelta
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from app.dependencies import require_admin, get_current_user
from app.services.supabase import get_supabase_admin
from app.services.variance import calculate_variance
from app.services.stock_guard import assert_sufficient_stock
from app.services.stock_level import _division_location

router = APIRouter()

VALID_REASONS = ("expired", "dropped", "spoiled", "wrong_prep", "other")


class WasteCreate(BaseModel):
    waste_date: date = Field(default_factory=date.today)
    ingredient_id: str
    qty: float = Field(gt=0)
    unit_id: str
    reason: str
    notes: Optional[str] = None


@router.post("/", status_code=201)
def log_waste(body: WasteCreate, user=Depends(require_admin)):
    if body.reason not in VALID_REASONS:
        raise HTTPException(400, f"reason harus salah satu dari: {', '.join(VALID_REASONS)}")

    client = get_supabase_admin()

    # Guard stok negatif: waste diambil dari lokasi division ingredient
    ing = (
        client.table("ingredients")
        .select("division")
        .eq("id", body.ingredient_id)
        .execute()
        .data
    )
    if not ing:
        raise HTTPException(404, "Ingredient tidak ditemukan")
    assert_sufficient_stock(body.ingredient_id, _division_location(ing[0]["division"]), body.qty, client)

    record = {
        "waste_date":    body.waste_date.isoformat(),
        "ingredient_id": body.ingredient_id,
        "qty":           body.qty,
        "unit_id":       body.unit_id,
        "reason":        body.reason,
        "notes":         body.notes,
        "recorded_by":   user["sub"],
    }
    res = client.table("waste_logs").insert(record).execute()
    if not res.data:
        raise HTTPException(500, "Gagal menyimpan waste log")

    # Trigger recalc variance untuk tanggal ini
    try:
        calculate_variance(body.waste_date, client)
    except Exception:
        pass  # Variance recalc bisa gagal kalau belum ada opname — tidak masalah

    return res.data[0]


@router.get("/")
def list_waste(
    date_from: Optional[date] = Query(None),
    date_to:   Optional[date] = Query(None),
    ingredient_id: Optional[str] = Query(None),
    reason:    Optional[str] = Query(None),
    user=Depends(get_current_user),
):
    client = get_supabase_admin()
    q = (
        client.table("waste_logs")
        .select(
            "*, "
            "ingredient:ingredients!ingredient_id(name, division), "
            "unit:units!unit_id(name, symbol)"
        )
        .order("waste_date", desc=True)
        .order("recorded_at", desc=True)
    )
    if date_from:
        q = q.gte("waste_date", date_from.isoformat())
    if date_to:
        q = q.lte("waste_date", date_to.isoformat())
    if ingredient_id:
        q = q.eq("ingredient_id", ingredient_id)
    if reason:
        q = q.eq("reason", reason)

    rows = q.execute().data or []

    def _flatten(row):
        ing  = row.pop("ingredient", None) or {}
        unit = row.pop("unit", None) or {}
        row["ingredient_name"]   = ing.get("name")
        row["ingredient_division"] = ing.get("division")
        row["unit_name"]         = unit.get("name")
        row["unit_symbol"]       = unit.get("symbol")
        return row

    return [_flatten(r) for r in rows]


@router.get("/summary")
def waste_summary(
    date_from: Optional[date] = Query(None),
    date_to:   Optional[date] = Query(None),
    user=Depends(get_current_user),
):
    """
    Total waste value (qty × avg_cost_per_unit) per ingredient untuk periode.
    Default: bulan ini.
    """
    today = date.today()
    if not date_from:
        date_from = date(today.year, today.month, 1)
    if not date_to:
        date_to = today

    client = get_supabase_admin()

    rows = (
        client.table("waste_logs")
        .select(
            "ingredient_id, qty, reason, "
            "ingredient:ingredients!ingredient_id(name, division, avg_cost_per_unit), "
            "unit:units!unit_id(name, symbol)"
        )
        .gte("waste_date", date_from.isoformat())
        .lte("waste_date", date_to.isoformat())
        .execute()
        .data
    ) or []

    # Aggregate per ingredient
    agg: dict[str, dict] = {}
    for row in rows:
        ing  = row.get("ingredient") or {}
        unit = row.get("unit") or {}
        iid  = row["ingredient_id"]
        qty  = float(row["qty"])
        cost = float(ing.get("avg_cost_per_unit") or 0)

        if iid not in agg:
            agg[iid] = {
                "ingredient_id":   iid,
                "ingredient_name": ing.get("name"),
                "division":        ing.get("division"),
                "unit_name":       unit.get("name"),
                "unit_symbol":     unit.get("symbol"),
                "total_qty":       0.0,
                "total_value":     0.0,
                "count":           0,
                "reasons":         {},
            }
        agg[iid]["total_qty"]   += qty
        agg[iid]["total_value"] += qty * cost
        agg[iid]["count"]       += 1
        r = row["reason"]
        agg[iid]["reasons"][r] = agg[iid]["reasons"].get(r, 0) + 1

    result = sorted(agg.values(), key=lambda x: x["total_value"], reverse=True)

    # Top 5 untuk chart
    top5 = result[:5]

    total_value = sum(r["total_value"] for r in result)

    return {
        "date_from":    date_from.isoformat(),
        "date_to":      date_to.isoformat(),
        "total_value":  round(total_value, 2),
        "total_entries": len(rows),
        "top5":         top5,
        "by_ingredient": result,
    }
