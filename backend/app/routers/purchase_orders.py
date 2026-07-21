"""
Purchase Order router — PO lifecycle: draft → sent → partial → received | cancelled.

po_number di-generate otomatis oleh DB function generate_po_number().
"""
import logging
from typing import Optional, List
from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, field_validator

from app.dependencies import require_admin, get_current_user
from app.services.supabase import get_supabase_admin

logger = logging.getLogger(__name__)
router = APIRouter()

# ── Valid transitions ─────────────────────────────────────────────────────────
VALID_TRANSITIONS = {
    "draft":    {"sent", "cancelled"},
    "sent":     {"partial", "received", "cancelled"},
    "partial":  {"received", "cancelled"},
    "received": set(),   # terminal
    "cancelled": set(),  # terminal
}

PO_STATUSES = {"draft", "sent", "partial", "received", "cancelled"}

# ── Pydantic models ───────────────────────────────────────────────────────────

class POItemCreate(BaseModel):
    ingredient_id: str
    ordered_qty:   Decimal
    unit_id:       str
    unit_price:    Decimal
    notes:         Optional[str] = None

    @field_validator("ordered_qty")
    @classmethod
    def qty_positive(cls, v):
        if v <= 0:
            raise ValueError("ordered_qty harus > 0")
        return v

    @field_validator("unit_price")
    @classmethod
    def price_non_negative(cls, v):
        if v < 0:
            raise ValueError("unit_price tidak boleh negatif")
        return v


class POCreate(BaseModel):
    vendor_id:         str
    po_category:       str = "kitchen"
    po_date:           Optional[date] = None
    expected_delivery: Optional[date] = None
    notes:             Optional[str] = None
    items:             List[POItemCreate]

    @field_validator("po_category")
    @classmethod
    def valid_category(cls, v):
        if v not in PO_CATEGORIES:
            raise ValueError(f"po_category tidak valid. Pilihan: {sorted(PO_CATEGORIES)}")
        return v

    @field_validator("items")
    @classmethod
    def items_not_empty(cls, v):
        if not v:
            raise ValueError("PO harus memiliki minimal 1 item")
        return v


class POStatusUpdate(BaseModel):
    status:          str
    actual_delivery: Optional[date] = None
    notes:           Optional[str] = None

    @field_validator("status")
    @classmethod
    def valid_status(cls, v):
        if v not in PO_STATUSES:
            raise ValueError(f"Status tidak valid. Pilihan: {sorted(PO_STATUSES)}")
        return v


# ── Helpers ───────────────────────────────────────────────────────────────────

SELECT_PO = (
    "id, po_number, status, po_category, po_date, expected_delivery, actual_delivery, notes,"
    " created_at, updated_at,"
    " vendor:vendors!vendor_id(id, name, contact_person, phone),"
    " created_by_user:users!created_by(id, name, email)"
)

PO_CATEGORIES = {"kitchen", "bar", "staff_meal", "operational"}

SELECT_PO_ITEM = (
    "id, ordered_qty, unit_price, total_price, notes,"
    " ingredient:ingredients!ingredient_id(id, name, ingredient_type),"
    " unit:units!unit_id(id, name, symbol)"
)


def _flatten_po(r: dict) -> dict:
    vendor = r.pop("vendor", None) or {}
    creator = r.pop("created_by_user", None) or {}
    r["vendor_id"]          = vendor.get("id")
    r["vendor_name"]        = vendor.get("name")
    r["vendor_contact"]     = vendor.get("contact_person")
    r["vendor_phone"]       = vendor.get("phone")
    r["created_by_name"]    = creator.get("name")
    r["created_by_email"]   = creator.get("email")
    return r


def _flatten_item(r: dict) -> dict:
    ing  = r.pop("ingredient", None) or {}
    unit = r.pop("unit", None) or {}
    r["ingredient_id"]   = ing.get("id")
    r["ingredient_name"] = ing.get("name")
    r["ingredient_type"] = ing.get("ingredient_type")
    r["unit_id"]         = unit.get("id")
    r["unit_name"]       = unit.get("name")
    r["unit_symbol"]     = unit.get("symbol")
    return r


def _get_po_or_404(po_id: str, client) -> dict:
    rows = (
        client.table("purchase_orders")
        .select(SELECT_PO)
        .eq("id", po_id)
        .execute()
        .data
    )
    if not rows:
        raise HTTPException(status_code=404, detail=f"PO {po_id} tidak ditemukan")
    return _flatten_po(rows[0])


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("")
def list_purchase_orders(
    status_filter: Optional[str] = Query(None, alias="status"),
    vendor_id:     Optional[str] = Query(None),
    date_from:     Optional[date] = Query(None),
    date_to:       Optional[date] = Query(None),
    limit:         int            = Query(50, ge=1, le=200),
    offset:        int            = Query(0, ge=0),
    user=Depends(get_current_user),
):
    """Daftar PO dengan filter opsional."""
    client = get_supabase_admin()
    q = client.table("purchase_orders").select(SELECT_PO, count="exact")

    if status_filter:
        if status_filter not in PO_STATUSES:
            raise HTTPException(400, f"Status tidak valid: {status_filter}")
        q = q.eq("status", status_filter)
    if vendor_id:
        q = q.eq("vendor_id", vendor_id)
    if date_from:
        q = q.gte("po_date", date_from.isoformat())
    if date_to:
        q = q.lte("po_date", date_to.isoformat())

    res = q.order("po_date", desc=True).range(offset, offset + limit - 1).execute()
    return {
        "total":  res.count,
        "offset": offset,
        "limit":  limit,
        "data":   [_flatten_po(r) for r in res.data],
    }


@router.post("", status_code=status.HTTP_201_CREATED)
def create_purchase_order(body: POCreate, user=Depends(require_admin)):
    """Buat PO baru (status=draft) beserta item-itemnya."""
    client = get_supabase_admin()

    # Validate vendor
    vendor_rows = client.table("vendors").select("id").eq("id", body.vendor_id).execute().data
    if not vendor_rows:
        raise HTTPException(404, f"Vendor {body.vendor_id} tidak ditemukan")

    # Validate all ingredient_ids and unit_ids exist
    ing_ids  = [it.ingredient_id for it in body.items]
    unit_ids = [it.unit_id       for it in body.items]

    existing_ings  = {r["id"] for r in client.table("ingredients").select("id").in_("id", ing_ids).execute().data}
    existing_units = {r["id"] for r in client.table("units").select("id").in_("id", unit_ids).execute().data}

    for it in body.items:
        if it.ingredient_id not in existing_ings:
            raise HTTPException(404, f"Ingredient {it.ingredient_id} tidak ditemukan")
        if it.unit_id not in existing_units:
            raise HTTPException(404, f"Unit {it.unit_id} tidak ditemukan")

    # Insert PO header — po_number auto-generated by DB
    po_payload = {
        "vendor_id":   body.vendor_id,
        "po_category": body.po_category,
        "status":      "draft",
        "notes":       body.notes,
        "created_by":  user["sub"],
    }
    if body.po_date:
        po_payload["po_date"] = body.po_date.isoformat()
    if body.expected_delivery:
        po_payload["expected_delivery"] = body.expected_delivery.isoformat()

    po_row = client.table("purchase_orders").insert(po_payload).execute().data[0]
    po_id  = po_row["id"]

    # Insert items
    items_payload = [
        {
            "po_id":        po_id,
            "ingredient_id": it.ingredient_id,
            "ordered_qty":  float(it.ordered_qty),
            "unit_id":      it.unit_id,
            "unit_price":   float(it.unit_price),
            "notes":        it.notes,
        }
        for it in body.items
    ]
    client.table("po_items").insert(items_payload).execute()

    return _get_po_or_404(po_id, client)


@router.get("/{po_id}")
def get_purchase_order(po_id: str, user=Depends(get_current_user)):
    """Detail PO beserta semua item-nya."""
    client = get_supabase_admin()
    po = _get_po_or_404(po_id, client)

    items = (
        client.table("po_items")
        .select(SELECT_PO_ITEM)
        .eq("po_id", po_id)
        .execute()
        .data
    )
    po["items"] = [_flatten_item(it) for it in items]

    total_value = sum(float(it.get("total_price") or 0) for it in po["items"])
    po["total_value"] = total_value

    return po


@router.put("/{po_id}/status")
def update_po_status(po_id: str, body: POStatusUpdate, user=Depends(require_admin)):
    """
    Update status PO — validasi lifecycle transitions:
    draft → sent → partial → received | cancelled
    """
    client = get_supabase_admin()

    # Fetch current PO
    rows = client.table("purchase_orders").select("id, status").eq("id", po_id).execute().data
    if not rows:
        raise HTTPException(404, f"PO {po_id} tidak ditemukan")

    current_status = rows[0]["status"]
    allowed        = VALID_TRANSITIONS.get(current_status, set())

    if body.status not in allowed:
        raise HTTPException(
            400,
            f"Tidak bisa transisi dari '{current_status}' ke '{body.status}'. "
            f"Transisi yang diizinkan: {sorted(allowed) if allowed else ['tidak ada (terminal)']}"
        )

    update_payload = {"status": body.status}
    if body.notes is not None:
        update_payload["notes"] = body.notes
    if body.actual_delivery and body.status == "received":
        update_payload["actual_delivery"] = body.actual_delivery.isoformat()

    client.table("purchase_orders").update(update_payload).eq("id", po_id).execute()

    return _get_po_or_404(po_id, client)


@router.put("/{po_id}")
def update_purchase_order(po_id: str, body: POCreate, user=Depends(require_admin)):
    """
    Update PO header + items — hanya bisa saat status=draft.
    Items diganti seluruhnya (delete lama, insert baru).
    """
    client = get_supabase_admin()

    rows = client.table("purchase_orders").select("id, status").eq("id", po_id).execute().data
    if not rows:
        raise HTTPException(404, f"PO {po_id} tidak ditemukan")
    if rows[0]["status"] != "draft":
        raise HTTPException(400, "PO hanya bisa diubah saat status=draft")

    # Update header
    update_payload = {
        "vendor_id":   body.vendor_id,
        "po_category": body.po_category,
        "notes":       body.notes,
    }
    if body.po_date:
        update_payload["po_date"] = body.po_date.isoformat()
    if body.expected_delivery:
        update_payload["expected_delivery"] = body.expected_delivery.isoformat()

    client.table("purchase_orders").update(update_payload).eq("id", po_id).execute()

    # Replace items
    client.table("po_items").delete().eq("po_id", po_id).execute()
    items_payload = [
        {
            "po_id":         po_id,
            "ingredient_id": it.ingredient_id,
            "ordered_qty":   float(it.ordered_qty),
            "unit_id":       it.unit_id,
            "unit_price":    float(it.unit_price),
            "notes":         it.notes,
        }
        for it in body.items
    ]
    client.table("po_items").insert(items_payload).execute()

    return get_purchase_order(po_id, user)


@router.delete("/{po_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_purchase_order(po_id: str, user=Depends(require_admin)):
    """Hapus PO — hanya bisa saat status=draft."""
    client = get_supabase_admin()

    rows = client.table("purchase_orders").select("id, status").eq("id", po_id).execute().data
    if not rows:
        raise HTTPException(404, f"PO {po_id} tidak ditemukan")
    if rows[0]["status"] != "draft":
        raise HTTPException(400, "Hanya PO dengan status=draft yang bisa dihapus")

    client.table("po_items").delete().eq("po_id", po_id).execute()
    client.table("purchase_orders").delete().eq("id", po_id).execute()
