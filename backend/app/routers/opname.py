"""
Opname (daily stock count) system.

GET  /opname/today?opname_date=  — semua ingredient aktif + qty yang sudah di-count
POST /opname                     — submit physical counts, trigger variance recalc
GET  /opname/history             — riwayat variance per periode
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from datetime import date
from collections import defaultdict
from typing import Optional
from decimal import Decimal

from app.models.opname import (
    OpnameSubmit, OpnameTodayResponse, OpnameDivisionGroup,
    OpnameIngredientItem, OpnameSubmitResponse, VarianceSummaryItem,
    StockAdjustmentRequest, StockAdjustmentResponse,
)
from app.dependencies import require_admin, get_current_user
from app.services.supabase import get_supabase_admin
from app.services.variance import calculate_variance

router = APIRouter()

# Urutan tampilan divisi
DIVISION_ORDER = ["kitchen", "bar", "both"]

# Select ingrediert dengan join unit
SELECT_ING = (
    "id, name, ingredient_type, division, base_unit_id, avg_cost_per_unit,"
    " unit:units!base_unit_id(name, symbol)"
)


def _build_today_response(
    target_date: date,
    client,
) -> OpnameTodayResponse:
    """Query ingredients + existing opname, susun per divisi."""
    date_str = target_date.isoformat()

    # 1. Semua ingredient aktif
    ingredients = (
        client.table("ingredients")
        .select(SELECT_ING)
        .eq("is_active", True)
        .order("division")
        .order("name")
        .execute()
        .data
    )

    if not ingredients:
        return OpnameTodayResponse(
            opname_date=target_date,
            groups=[],
            total_ingredients=0,
            total_counted=0,
        )

    # 2. Opname yang sudah ada hari ini (satu query)
    ing_ids = [i["id"] for i in ingredients]
    existing_opname = (
        client.table("daily_stock_opname")
        .select("id, ingredient_id, physical_qty, unit_id, notes, counted_at")
        .eq("opname_date", date_str)
        .in_("ingredient_id", ing_ids)
        .execute()
        .data
    )
    opname_lookup: dict[str, dict] = {o["ingredient_id"]: o for o in existing_opname}

    # 3. Kelompokkan per divisi
    groups_map: dict[str, list[OpnameIngredientItem]] = defaultdict(list)

    for ing in ingredients:
        unit   = ing.get("unit") or {}
        opname = opname_lookup.get(ing["id"])

        groups_map[ing["division"]].append(
            OpnameIngredientItem(
                ingredient_id=ing["id"],
                name=ing["name"],
                ingredient_type=ing["ingredient_type"],
                division=ing["division"],
                base_unit_id=ing["base_unit_id"],
                unit_name=unit.get("name"),
                unit_symbol=unit.get("symbol"),
                avg_cost_per_unit=Decimal(str(ing["avg_cost_per_unit"])) if ing.get("avg_cost_per_unit") else None,
                physical_qty=Decimal(str(opname["physical_qty"])) if opname else None,
                opname_unit_id=opname["unit_id"] if opname else None,
                opname_id=opname["id"] if opname else None,
                notes=opname.get("notes") if opname else None,
                counted_at=opname.get("counted_at") if opname else None,
            )
        )

    # 4. Susun dalam urutan divisi yang konsisten
    ordered_divs = [d for d in DIVISION_ORDER if d in groups_map]
    for d in groups_map:
        if d not in ordered_divs:
            ordered_divs.append(d)

    groups = [
        OpnameDivisionGroup(division=div, ingredients=groups_map[div])
        for div in ordered_divs
    ]

    total_counted = sum(1 for o in opname_lookup.values())

    return OpnameTodayResponse(
        opname_date=target_date,
        groups=groups,
        total_ingredients=len(ingredients),
        total_counted=total_counted,
    )


# ── GET /opname/today ──────────────────────────────────────────────────────────

@router.get("/today", response_model=OpnameTodayResponse)
def get_opname_today(
    opname_date: Optional[date] = Query(None, description="Default: hari ini"),
    user=Depends(get_current_user),
):
    """
    Semua ingredient aktif dikelompokkan per divisi.
    Setiap ingredient menyertakan physical_qty jika sudah di-count hari ini.
    """
    client = get_supabase_admin()
    target_date = opname_date or date.today()
    return _build_today_response(target_date, client)


# ── POST /opname ───────────────────────────────────────────────────────────────

@router.post("/", response_model=OpnameSubmitResponse)
def submit_opname(body: OpnameSubmit, user=Depends(require_admin)):
    """
    Submit physical count untuk satu tanggal.

    - Upsert ke daily_stock_opname (UNIQUE opname_date + ingredient_id)
    - Trigger calculate_variance untuk tanggal tersebut
    - Return: jumlah ingredient tersimpan, jumlah yang di-flag, top 5 variance terburuk
    """
    client  = get_supabase_admin()
    date_str = body.opname_date.isoformat()

    # Validasi: semua ingredient_id harus ada dan aktif
    ing_ids_submitted = [c.ingredient_id for c in body.counts]
    existing = (
        client.table("ingredients")
        .select("id")
        .in_("id", ing_ids_submitted)
        .eq("is_active", True)
        .execute()
        .data
    )
    valid_ids = {i["id"] for i in existing}
    invalid   = [iid for iid in ing_ids_submitted if iid not in valid_ids]
    if invalid:
        raise HTTPException(
            status_code=422,
            detail=f"ingredient_id tidak ditemukan atau nonaktif: {invalid}",
        )

    # Upsert ke daily_stock_opname
    records = [
        {
            "opname_date":   date_str,
            "ingredient_id": c.ingredient_id,
            "physical_qty":  float(c.physical_qty),
            "unit_id":       c.unit_id,
            "counted_by":    user["sub"],
            "notes":         c.notes,
        }
        for c in body.counts
    ]

    client.table("daily_stock_opname").upsert(
        records,
        on_conflict="opname_date,ingredient_id",
    ).execute()

    # Recalculate variance untuk tanggal ini
    variance_results = calculate_variance(body.opname_date, client)

    flagged_count = sum(1 for v in variance_results if v["is_flagged"])

    # Top 5 terburuk berdasarkan |variance_pct|
    top5 = variance_results[:5]
    variance_summary = [
        VarianceSummaryItem(
            ingredient_id=v["ingredient_id"],
            ingredient_name=v["ingredient_name"],
            division=v["division"],
            variance_qty=Decimal(str(v["variance_qty"])),
            variance_pct=Decimal(str(v["variance_pct"])),
            is_flagged=v["is_flagged"],
            theoretical_closing=Decimal(str(v["theoretical_closing"])) if v.get("theoretical_closing") is not None else None,
            actual_closing_qty=Decimal(str(v["actual_closing_qty"])) if v.get("actual_closing_qty") is not None else None,
        )
        for v in top5
    ]

    return OpnameSubmitResponse(
        opname_date=body.opname_date,
        saved=len(records),
        flagged=flagged_count,
        variance_summary=variance_summary,
    )


# ── GET /opname/history ────────────────────────────────────────────────────────

@router.get("/history")
def get_opname_history(
    date_from: date = Query(...),
    date_to:   date = Query(...),
    flagged_only: bool = Query(False, description="Hanya tampilkan yang di-flag"),
    division: Optional[str] = Query(None, description="Filter: kitchen | bar | both"),
    user=Depends(get_current_user),
):
    """
    Riwayat variance per ingredient per hari untuk periode tertentu.
    Diurutkan: tanggal terbaru → paling lama, dalam hari diurutkan |variance_pct| desc.
    Maksimal 90 hari.
    """
    if date_from > date_to:
        raise HTTPException(status_code=422, detail="date_from harus <= date_to")
    if (date_to - date_from).days > 90:
        raise HTTPException(status_code=422, detail="Maksimal rentang 90 hari")

    client = get_supabase_admin()

    q = (
        client.table("variance_reports")
        .select(
            "report_date, ingredient_id, opening_qty, production_in_qty,"
            " theoretical_out_qty, theoretical_closing, actual_closing_qty,"
            " variance_qty, variance_pct, is_flagged, unit_id, calculated_at,"
            " ingredient:ingredients!ingredient_id(name, division)"
        )
        .gte("report_date", date_from.isoformat())
        .lte("report_date", date_to.isoformat())
    )

    if flagged_only:
        q = q.eq("is_flagged", True)

    rows = q.order("report_date", desc=True).order("variance_pct").execute().data

    # Flatten ingredient join + optional division filter
    result = []
    for r in rows:
        ing = r.pop("ingredient", None) or {}
        r["ingredient_name"] = ing.get("name", "")
        r["division"]        = ing.get("division", "")
        if division and r["division"] != division:
            continue
        result.append(r)

    return result


# ── POST /opnames/{opname_id}/adjust ───────────────────────────────────────

@router.post("/{opname_id}/adjust", response_model=StockAdjustmentResponse)
def adjust_stock_to_opname(opname_id: str, body: StockAdjustmentRequest, user=Depends(require_admin)):
    """
    Reconcile ledger to opname: insert stock_adjustments row for this opname.

    - Fetch opname by id (daily_stock_opname)
    - Fetch variance_reports for same report_date + ingredient_id
    - Calculate delta = actual_closing - theoretical_closing
    - Return 400 if delta == 0 (no variance to adjust)
    - Check idempotent: return 409 if opname_id already adjusted
    - Insert stock_adjustments row
    - Return adjustment record
    """
    client = get_supabase_admin()

    # 1. Get opname
    opname_rows = (
        client.table("daily_stock_opname")
        .select("id, opname_date, ingredient_id, physical_qty")
        .eq("id", opname_id)
        .execute()
        .data
    )
    if not opname_rows:
        raise HTTPException(404, f"Opname {opname_id} tidak ditemukan")

    opname = opname_rows[0]
    ingredient_id = opname["ingredient_id"]

    # 2. Delta = fisik (opname) - stok ledger saat ini.
    #    BUKAN variance delta (actual - theoretical_closing): theoretical dihitung
    #    dari opname kemarin, bukan dari ledger — pada opname perdana theoretical=0
    #    sehingga variance delta = full qty dan ledger jadi dobel. Rekonsiliasi
    #    ledger ke fisik harus dibanding ledger itu sendiri.
    from app.services.stock_level import get_current_stock
    ledger = float(get_current_stock([ingredient_id], client)[0]["current_stock"])
    actual = float(opname.get("physical_qty") or 0)
    delta = actual - ledger

    # 3. Check delta != 0
    if delta == 0:
        raise HTTPException(
            400,
            "Stok sistem sudah sama dengan hasil opname — tidak perlu adjustment. "
            "(Variance yang flagged bisa berasal dari opname hari sebelumnya yang belum ada, "
            "bukan dari stok yang salah.)",
        )

    # 4. Check idempotent: opname_id belum pernah di-adjust
    existing_adjust = (
        client.table("stock_adjustments")
        .select("id")
        .eq("opname_id", opname_id)
        .execute()
        .data
    )
    if existing_adjust:
        raise HTTPException(409, "Opname ini sudah pernah di-adjust")

    # 5. Insert stock_adjustments
    # SENGAJA TANPA assert_sufficient_stock (stock_guard.py): adjustment adalah
    # koreksi manual dari opname — tujuannya membetulkan ledger yang salah,
    # kadang perlu menarik angka ke bawah nol. Exclude disengaja, bukan celah.
    adjust_row = client.table("stock_adjustments").insert({
        "ingredient_id": ingredient_id,
        "qty_delta": delta,
        "reason": body.reason,
        "opname_id": opname_id,
        "created_by": user["sub"],
    }).execute().data[0]

    # 6. Fetch ingredient name + user name for response
    ing_data = (
        client.table("ingredients")
        .select("id, name")
        .eq("id", ingredient_id)
        .execute()
        .data
    )
    ing_name = ing_data[0]["name"] if ing_data else ""

    user_data = (
        client.table("users")
        .select("id, name")
        .eq("id", user["sub"])
        .execute()
        .data
    )
    user_name = user_data[0]["name"] if user_data else ""

    return StockAdjustmentResponse(
        id=adjust_row["id"],
        ingredient_id=ingredient_id,
        ingredient_name=ing_name,
        qty_delta=Decimal(str(delta)),
        reason=body.reason,
        opname_id=opname_id,
        created_by_name=user_name,
        created_at=adjust_row["created_at"],
    )
