from fastapi import APIRouter, Depends, HTTPException, status
from app.models.unit import (
    UnitCreate, UnitUpdate, UnitResponse,
    ConversionCreate, ConversionUpdate, ConversionResponse,
)
from app.dependencies import require_admin
from app.services.supabase import get_supabase_admin

router = APIRouter()


# ─────────────────────────────────────────────
# UNITS
# ─────────────────────────────────────────────

@router.get("/", response_model=list[UnitResponse])
def list_units():
    return get_supabase_admin().table("units").select("*").order("name").execute().data


@router.get("/{unit_id}", response_model=UnitResponse)
def get_unit(unit_id: str):
    result = (
        get_supabase_admin()
        .table("units")
        .select("*")
        .eq("id", unit_id)
        .maybe_single()
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Unit tidak ditemukan")
    return result.data


@router.post("/", response_model=UnitResponse, status_code=status.HTTP_201_CREATED)
def create_unit(body: UnitCreate, user=Depends(require_admin)):
    try:
        result = get_supabase_admin().table("units").insert(body.model_dump()).execute()
        return result.data[0]
    except Exception as e:
        if "unique" in str(e).lower():
            raise HTTPException(status_code=409, detail=f"Unit '{body.name}' sudah ada")
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/{unit_id}", response_model=UnitResponse)
def update_unit(unit_id: str, body: UnitUpdate, user=Depends(require_admin)):
    data = body.model_dump(exclude_none=True)
    if not data:
        raise HTTPException(status_code=422, detail="Tidak ada field yang diupdate")
    result = (
        get_supabase_admin()
        .table("units")
        .update(data)
        .eq("id", unit_id)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Unit tidak ditemukan")
    return result.data[0]


@router.delete("/{unit_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_unit(unit_id: str, user=Depends(require_admin)):
    # Cek apakah unit dipakai di ingredients atau recipes
    used = (
        get_supabase_admin()
        .table("ingredients")
        .select("id", count="exact")
        .eq("base_unit_id", unit_id)
        .execute()
    )
    if used.count and used.count > 0:
        raise HTTPException(
            status_code=409,
            detail=f"Unit tidak bisa dihapus — dipakai oleh {used.count} ingredient",
        )
    get_supabase_admin().table("units").delete().eq("id", unit_id).execute()


# ─────────────────────────────────────────────
# UNIT CONVERSIONS
# ─────────────────────────────────────────────

@router.get("/conversions/", response_model=list[ConversionResponse])
def list_conversions():
    rows = (
        get_supabase_admin()
        .table("unit_conversions")
        .select("*, from_unit:units!from_unit_id(name), to_unit:units!to_unit_id(name)")
        .execute()
        .data
    )
    # Flatten join fields
    result = []
    for r in rows:
        r["from_unit_name"] = r.pop("from_unit", {}).get("name") if r.get("from_unit") else None
        r["to_unit_name"] = r.pop("to_unit", {}).get("name") if r.get("to_unit") else None
        result.append(r)
    return result


@router.get("/conversions/{conversion_id}", response_model=ConversionResponse)
def get_conversion(conversion_id: str):
    result = (
        get_supabase_admin()
        .table("unit_conversions")
        .select("*, from_unit:units!from_unit_id(name), to_unit:units!to_unit_id(name)")
        .eq("id", conversion_id)
        .maybe_single()
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Konversi tidak ditemukan")
    r = result.data
    r["from_unit_name"] = r.pop("from_unit", {}).get("name") if r.get("from_unit") else None
    r["to_unit_name"] = r.pop("to_unit", {}).get("name") if r.get("to_unit") else None
    return r


@router.post("/conversions/", response_model=ConversionResponse, status_code=status.HTTP_201_CREATED)
def create_conversion(body: ConversionCreate, user=Depends(require_admin)):
    if body.from_unit_id == body.to_unit_id:
        raise HTTPException(status_code=422, detail="from_unit dan to_unit tidak boleh sama")
    try:
        result = (
            get_supabase_admin()
            .table("unit_conversions")
            .insert(body.model_dump())
            .execute()
        )
        row = result.data[0]
        row["from_unit_name"] = None
        row["to_unit_name"] = None
        return row
    except Exception as e:
        if "unique" in str(e).lower():
            raise HTTPException(status_code=409, detail="Konversi untuk pasangan unit ini sudah ada")
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/conversions/{conversion_id}", response_model=ConversionResponse)
def update_conversion(conversion_id: str, body: ConversionUpdate, user=Depends(require_admin)):
    data = body.model_dump(exclude_none=True)
    if not data:
        raise HTTPException(status_code=422, detail="Tidak ada field yang diupdate")
    result = (
        get_supabase_admin()
        .table("unit_conversions")
        .update(data)
        .eq("id", conversion_id)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Konversi tidak ditemukan")
    row = result.data[0]
    row["from_unit_name"] = None
    row["to_unit_name"] = None
    return row


@router.delete("/conversions/{conversion_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_conversion(conversion_id: str, user=Depends(require_admin)):
    get_supabase_admin().table("unit_conversions").delete().eq("id", conversion_id).execute()
