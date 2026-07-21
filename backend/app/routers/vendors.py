from fastapi import APIRouter, Depends, HTTPException, Query, status
from typing import Optional

from app.models.vendor import (
    VendorCreate, VendorUpdate, VendorResponse,
    IngredientVendorLink, IngredientVendorUpdate, IngredientVendorResponse,
)
from app.dependencies import require_admin, get_current_user
from app.services.supabase import get_supabase_admin

router = APIRouter()

SELECT_IV = (
    "id, vendor_id, ingredient_id, is_primary_vendor, last_price_per_unit, unit_id, notes, updated_at,"
    " ingredient:ingredients!ingredient_id(name, ingredient_type),"
    " unit:units!unit_id(name)"
)


def _flatten_iv(r: dict) -> dict:
    ing = r.pop("ingredient", None) or {}
    unit = r.pop("unit", None) or {}
    r["ingredient_name"] = ing.get("name")
    r["ingredient_type"] = ing.get("ingredient_type")
    r["unit_name"] = unit.get("name")
    return r


# ─────────────────────────────────────────────
# VENDORS CRUD
# ─────────────────────────────────────────────

@router.get("/", response_model=list[VendorResponse])
def list_vendors(
    active: bool = Query(True),
    search: Optional[str] = Query(None),
    user=Depends(get_current_user),
):
    q = get_supabase_admin().table("vendors").select("*").eq("is_active", active)
    if search:
        q = q.ilike("name", f"%{search}%")
    return q.order("name").execute().data


@router.get("/{vendor_id}", response_model=VendorResponse)
def get_vendor(vendor_id: str, user=Depends(get_current_user)):
    result = (
        get_supabase_admin()
        .table("vendors")
        .select("*")
        .eq("id", vendor_id)
        .maybe_single()
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Vendor tidak ditemukan")
    return result.data


@router.post("/", response_model=VendorResponse, status_code=status.HTTP_201_CREATED)
def create_vendor(body: VendorCreate, user=Depends(require_admin)):
    try:
        result = get_supabase_admin().table("vendors").insert(body.model_dump(mode="json")).execute()
        return result.data[0]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/{vendor_id}", response_model=VendorResponse)
def update_vendor(vendor_id: str, body: VendorUpdate, user=Depends(require_admin)):
    client = get_supabase_admin()
    data = body.model_dump(exclude_none=True, mode="json")
    if not data:
        raise HTTPException(status_code=422, detail="Tidak ada field yang diupdate")
    result = client.table("vendors").update(data).eq("id", vendor_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Vendor tidak ditemukan")
    return result.data[0]


@router.delete("/{vendor_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_vendor(vendor_id: str, user=Depends(require_admin)):
    client = get_supabase_admin()
    existing = client.table("vendors").select("id").eq("id", vendor_id).maybe_single().execute()
    if not existing.data:
        raise HTTPException(status_code=404, detail="Vendor tidak ditemukan")
    # Soft delete
    client.table("vendors").update({"is_active": False}).eq("id", vendor_id).execute()


# ─────────────────────────────────────────────
# INGREDIENT ↔ VENDOR LINKS
# ─────────────────────────────────────────────

@router.get("/{vendor_id}/ingredients", response_model=list[IngredientVendorResponse])
def list_vendor_ingredients(vendor_id: str, user=Depends(get_current_user)):
    """Semua ingredient yang dipasok vendor ini, beserta harga terakhir."""
    # Pastikan vendor ada
    v = get_supabase_admin().table("vendors").select("id").eq("id", vendor_id).maybe_single().execute()
    if not v.data:
        raise HTTPException(status_code=404, detail="Vendor tidak ditemukan")

    rows = (
        get_supabase_admin()
        .table("ingredient_vendors")
        .select(SELECT_IV)
        .eq("vendor_id", vendor_id)
        .order("ingredient_id")
        .execute()
        .data
    )
    return [_flatten_iv(r) for r in rows]


@router.post("/{vendor_id}/ingredients", response_model=IngredientVendorResponse, status_code=status.HTTP_201_CREATED)
def link_ingredient(vendor_id: str, body: IngredientVendorLink, user=Depends(require_admin)):
    """Link ingredient ke vendor dengan harga opsional."""
    client = get_supabase_admin()

    # Validasi vendor
    v = client.table("vendors").select("id").eq("id", vendor_id).maybe_single().execute()
    if not v.data:
        raise HTTPException(status_code=404, detail="Vendor tidak ditemukan")

    # Validasi ingredient
    ing = client.table("ingredients").select("id").eq("id", body.ingredient_id).maybe_single().execute()
    if not ing.data:
        raise HTTPException(status_code=422, detail=f"ingredient_id '{body.ingredient_id}' tidak ditemukan")

    # Validasi unit jika diisi
    if body.unit_id:
        unit = client.table("units").select("id").eq("id", body.unit_id).maybe_single().execute()
        if not unit.data:
            raise HTTPException(status_code=422, detail=f"unit_id '{body.unit_id}' tidak ditemukan")

    # Jika set sebagai primary, clear primary vendor lain untuk ingredient ini
    if body.is_primary_vendor:
        client.table("ingredient_vendors").update({"is_primary_vendor": False}).eq("ingredient_id", body.ingredient_id).execute()

    record = {
        "vendor_id": vendor_id,
        "ingredient_id": body.ingredient_id,
        "is_primary_vendor": body.is_primary_vendor,
        "last_price_per_unit": float(body.last_price_per_unit) if body.last_price_per_unit is not None else None,
        "unit_id": body.unit_id,
        "notes": body.notes,
    }

    try:
        result = client.table("ingredient_vendors").insert(record).execute()
    except Exception as e:
        if "unique" in str(e).lower():
            raise HTTPException(status_code=409, detail="Ingredient ini sudah terhubung ke vendor tersebut")
        raise HTTPException(status_code=500, detail=str(e))

    row = (
        client.table("ingredient_vendors")
        .select(SELECT_IV)
        .eq("id", result.data[0]["id"])
        .single()
        .execute()
    ).data
    return _flatten_iv(row)


@router.put("/{vendor_id}/ingredients/{ingredient_id}", response_model=IngredientVendorResponse)
def update_ingredient_vendor(
    vendor_id: str,
    ingredient_id: str,
    body: IngredientVendorUpdate,
    user=Depends(require_admin),
):
    """Update harga atau status primary untuk link vendor-ingredient."""
    client = get_supabase_admin()

    existing = (
        client.table("ingredient_vendors")
        .select("id, ingredient_id")
        .eq("vendor_id", vendor_id)
        .eq("ingredient_id", ingredient_id)
        .maybe_single()
        .execute()
    )
    if not existing.data:
        raise HTTPException(status_code=404, detail="Link vendor-ingredient tidak ditemukan")

    data = body.model_dump(exclude_none=True, mode="json")
    if not data:
        raise HTTPException(status_code=422, detail="Tidak ada field yang diupdate")

    # Jika set primary, clear yang lain dulu
    if data.get("is_primary_vendor"):
        client.table("ingredient_vendors").update({"is_primary_vendor": False}).eq("ingredient_id", ingredient_id).execute()

    client.table("ingredient_vendors").update(data).eq("id", existing.data["id"]).execute()

    row = (
        client.table("ingredient_vendors")
        .select(SELECT_IV)
        .eq("id", existing.data["id"])
        .single()
        .execute()
    ).data
    return _flatten_iv(row)


@router.delete("/{vendor_id}/ingredients/{ingredient_id}", status_code=status.HTTP_204_NO_CONTENT)
def unlink_ingredient(vendor_id: str, ingredient_id: str, user=Depends(require_admin)):
    """Hapus link antara vendor dan ingredient."""
    client = get_supabase_admin()
    existing = (
        client.table("ingredient_vendors")
        .select("id")
        .eq("vendor_id", vendor_id)
        .eq("ingredient_id", ingredient_id)
        .maybe_single()
        .execute()
    )
    if not existing.data:
        raise HTTPException(status_code=404, detail="Link vendor-ingredient tidak ditemukan")
    client.table("ingredient_vendors").delete().eq("id", existing.data["id"]).execute()
