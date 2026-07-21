"""
Transfer stok antar lokasi (storage ↔ bar/kitchen/staff_meal/operational).

Insert transfer = kurangi stock di from_location, tambah di to_location —
efeknya dihitung di services/stock_level.py, tabel ini pure ledger.
Tidak ada approval workflow (1 admin, self-approve).
"""
from datetime import date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field

from app.dependencies import get_current_user, require_admin
from app.services.stock_guard import assert_sufficient_stock
from app.services.stock_level import LOCATIONS
from app.services.supabase import get_supabase_admin

router = APIRouter()


class TransferCreate(BaseModel):
    ingredient_id: str
    qty:           float = Field(gt=0, description="Qty dalam base unit ingredient")
    from_location: str
    to_location:   str
    transfer_date: date = Field(default_factory=date.today)
    notes:         Optional[str] = None


@router.post("/", status_code=status.HTTP_201_CREATED)
def create_transfer(body: TransferCreate, user=Depends(require_admin)):
    if body.from_location not in LOCATIONS or body.to_location not in LOCATIONS:
        raise HTTPException(422, f"Lokasi harus salah satu dari: {', '.join(LOCATIONS)}")
    if body.from_location == body.to_location:
        raise HTTPException(422, "from_location dan to_location tidak boleh sama")

    client = get_supabase_admin()
    ing = client.table("ingredients").select("id").eq("id", body.ingredient_id).execute().data
    if not ing:
        raise HTTPException(404, "Ingredient tidak ditemukan")

    # Guard stok negatif: from_location (termasuk storage) tidak boleh
    # ditransfer keluar melebihi stok yang ada di sana
    assert_sufficient_stock(body.ingredient_id, body.from_location, body.qty, client)

    row = client.table("stock_transfers").insert({
        "ingredient_id": body.ingredient_id,
        "qty":           body.qty,
        "from_location": body.from_location,
        "to_location":   body.to_location,
        "transfer_date": body.transfer_date.isoformat(),
        "notes":         body.notes,
        "created_by":    user["sub"],
    }).execute().data[0]
    return row


@router.get("/")
def list_transfers(
    ingredient_id: Optional[str] = Query(None),
    date_from:     Optional[date] = Query(None),
    date_to:       Optional[date] = Query(None),
    user=Depends(get_current_user),
):
    client = get_supabase_admin()
    q = client.table("stock_transfers").select(
        "*, ingredient:ingredients!ingredient_id(name)"
    )
    if ingredient_id:
        q = q.eq("ingredient_id", ingredient_id)
    if date_from:
        q = q.gte("transfer_date", date_from.isoformat())
    if date_to:
        q = q.lte("transfer_date", date_to.isoformat())
    rows = q.order("created_at", desc=True).execute().data or []
    for r in rows:
        r["ingredient_name"] = (r.pop("ingredient", None) or {}).get("name")
    return rows
