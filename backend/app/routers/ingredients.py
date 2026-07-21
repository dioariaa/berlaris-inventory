from fastapi import APIRouter, Depends, HTTPException, Query, status
from typing import Optional
from app.models.ingredient import IngredientCreate, IngredientUpdate, IngredientResponse
from app.dependencies import require_admin, get_current_user
from app.services.supabase import get_supabase_admin

router = APIRouter()

SELECT_WITH_UNIT = "*, unit:units!base_unit_id(name, symbol)"


def _flatten(row: dict) -> dict:
    """Flatten join unit ke field langsung."""
    unit = row.pop("unit", None) or {}
    row["base_unit_name"] = unit.get("name")
    row["base_unit_symbol"] = unit.get("symbol")
    return row


@router.get("/", response_model=list[IngredientResponse])
def list_ingredients(
    division: Optional[str] = Query(None, description="kitchen | bar | both"),
    type: Optional[str] = Query(None, alias="type", description="raw | processed | packaging"),
    active: bool = Query(True, description="Filter is_active"),
    search: Optional[str] = Query(None, description="Cari berdasarkan nama"),
    user=Depends(get_current_user),
):
    q = get_supabase_admin().table("ingredients").select(SELECT_WITH_UNIT).eq("is_active", active)
    if division:
        q = q.eq("division", division)
    if type:
        q = q.eq("ingredient_type", type)
    if search:
        q = q.ilike("name", f"%{search}%")
    rows = q.order("name").execute().data
    return [_flatten(r) for r in rows]


@router.get("/{ingredient_id}", response_model=IngredientResponse)
def get_ingredient(ingredient_id: str, user=Depends(get_current_user)):
    result = (
        get_supabase_admin()
        .table("ingredients")
        .select(SELECT_WITH_UNIT)
        .eq("id", ingredient_id)
        .maybe_single()
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Ingredient tidak ditemukan")
    return _flatten(result.data)


@router.post("/", response_model=IngredientResponse, status_code=status.HTTP_201_CREATED)
def create_ingredient(body: IngredientCreate, user=Depends(require_admin)):
    client = get_supabase_admin()

    # Pastikan base_unit_id valid
    unit_check = client.table("units").select("id").eq("id", body.base_unit_id).maybe_single().execute()
    if not unit_check.data:
        raise HTTPException(status_code=422, detail=f"unit_id '{body.base_unit_id}' tidak ditemukan")

    # processed wajib punya portion_size_g
    if body.ingredient_type == "processed" and body.portion_size_g is None:
        raise HTTPException(status_code=422, detail="Processed ingredient wajib mengisi portion_size_g")

    try:
        result = client.table("ingredients").insert(
            body.model_dump(mode="json")
        ).execute()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    row = (
        client.table("ingredients")
        .select(SELECT_WITH_UNIT)
        .eq("id", result.data[0]["id"])
        .single()
        .execute()
    ).data
    return _flatten(row)


@router.put("/{ingredient_id}", response_model=IngredientResponse)
def update_ingredient(ingredient_id: str, body: IngredientUpdate, user=Depends(require_admin)):
    client = get_supabase_admin()

    data = body.model_dump(exclude_none=True)
    if not data:
        raise HTTPException(status_code=422, detail="Tidak ada field yang diupdate")

    if "base_unit_id" in data:
        unit_check = client.table("units").select("id").eq("id", data["base_unit_id"]).maybe_single().execute()
        if not unit_check.data:
            raise HTTPException(status_code=422, detail=f"unit_id '{data['base_unit_id']}' tidak ditemukan")

    # Serialize Decimal ke float sebelum kirim ke Supabase
    data = {k: float(v) if hasattr(v, "__float__") and not isinstance(v, (bool, str)) else v
            for k, v in data.items()}

    result = client.table("ingredients").update(data).eq("id", ingredient_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Ingredient tidak ditemukan")

    row = (
        client.table("ingredients")
        .select(SELECT_WITH_UNIT)
        .eq("id", ingredient_id)
        .single()
        .execute()
    ).data
    return _flatten(row)


@router.get("/{ingredient_id}/price-comparison")
def price_comparison(ingredient_id: str, user=Depends(get_current_user)):
    """
    Bandingkan harga semua vendor untuk satu ingredient.
    Returns list vendor sorted by unit_price asc, dengan flag cheapest + primary.
    """
    client = get_supabase_admin()

    # Cek ingredient ada
    ing = (
        client.table("ingredients")
        .select("id, name, avg_cost_per_unit, base_unit_id, unit:units!base_unit_id(name, symbol)")
        .eq("id", ingredient_id)
        .maybe_single()
        .execute()
        .data
    )
    if not ing:
        raise HTTPException(status_code=404, detail="Ingredient tidak ditemukan")

    # Ambil semua vendor links untuk ingredient ini
    links = (
        client.table("ingredient_vendors")
        .select(
            "vendor_id, unit_price, unit_id, is_primary, notes,"
            "vendor:vendors!vendor_id(name, contact_name, phone),"
            "unit:units!unit_id(name, symbol)"
        )
        .eq("ingredient_id", ingredient_id)
        .execute()
        .data
    ) or []

    if not links:
        unit = ing.get("unit") or {}
        return {
            "ingredient_id":   ingredient_id,
            "ingredient_name": ing["name"],
            "unit_symbol":     unit.get("symbol"),
            "avg_cost_per_unit": float(ing.get("avg_cost_per_unit") or 0),
            "vendors": [],
            "cheapest_vendor_id": None,
            "primary_is_cheapest": True,
        }

    def _parse(link):
        vendor = link.get("vendor") or {}
        unit   = link.get("unit") or {}
        return {
            "vendor_id":    link["vendor_id"],
            "vendor_name":  vendor.get("name", "?"),
            "contact_name": vendor.get("contact_name"),
            "phone":        vendor.get("phone"),
            "unit_price":   float(link.get("unit_price") or 0),
            "unit_name":    unit.get("name"),
            "unit_symbol":  unit.get("symbol"),
            "is_primary":   link.get("is_primary", False),
            "notes":        link.get("notes"),
        }

    vendors = sorted([_parse(l) for l in links], key=lambda x: x["unit_price"])

    cheapest_id = vendors[0]["vendor_id"] if vendors else None
    primary_id  = next((v["vendor_id"] for v in vendors if v["is_primary"]), None)

    ing_unit = ing.get("unit") or {}

    return {
        "ingredient_id":      ingredient_id,
        "ingredient_name":    ing["name"],
        "unit_symbol":        ing_unit.get("symbol"),
        "avg_cost_per_unit":  float(ing.get("avg_cost_per_unit") or 0),
        "vendors":            vendors,
        "cheapest_vendor_id": cheapest_id,
        "primary_vendor_id":  primary_id,
        "primary_is_cheapest": primary_id == cheapest_id,
    }


@router.delete("/{ingredient_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_ingredient(ingredient_id: str, user=Depends(require_admin)):
    client = get_supabase_admin()

    # Cek ingredient ada
    existing = client.table("ingredients").select("id, name").eq("id", ingredient_id).maybe_single().execute()
    if not existing.data:
        raise HTTPException(status_code=404, detail="Ingredient tidak ditemukan")

    # Soft delete
    client.table("ingredients").update({"is_active": False}).eq("id", ingredient_id).execute()
