from datetime import date
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field, field_validator

from app.dependencies import get_current_user, require_admin
from app.services.stock_level import get_current_stock
from app.services.supabase import get_supabase_admin

router = APIRouter()


@router.get("/current")
def current_stock(
    division: Optional[str] = Query(None, description="kitchen | bar | both"),
    type: Optional[str] = Query(None, description="raw | processed | packaging"),
    location: Optional[str] = Query(None, description="storage | bar | kitchen | staff_meal | operational"),
    low_only: bool = Query(False, description="Hanya tampilkan bahan yang stok rendah/kritis"),
    user=Depends(get_current_user),
):
    """
    Posisi stok semua bahan saat ini (pure ledger, lihat services/stock_level.py).

    Setiap row berisi `current_stock` (total) dan `locations` (breakdown per
    lokasi). Param `location` mengganti current_stock dengan qty lokasi itu.
    """
    result = get_current_stock()

    if division:
        result = [r for r in result if r["division"] == division]
    if type:
        result = [r for r in result if r["ingredient_type"] == type]
    if location:
        for r in result:
            r["current_stock"] = r["locations"].get(location, 0.0)
    if low_only:
        result = [r for r in result if r["is_critical"] or r["is_low"]]

    return result


# ─────────────────────────────────────────────────────────────────────────────
# Initial Stock (opening balance)
# ─────────────────────────────────────────────────────────────────────────────
# Pencatatan stok fisik saat sistem PERTAMA KALI dipakai untuk resto yang
# sudah jalan. Bukan pembelian baru (harga=0, tidak mengubah avg_cost) dan
# bukan opname (opname adalah pembanding harian, ini titik mulai ledger).
# Disimpan sebagai goods_receipts dengan is_initial_stock=true.

class InitialStockItem(BaseModel):
    ingredient_id: str
    qty:           float = Field(ge=0)
    unit_id:       str


class InitialStockRequest(BaseModel):
    stock_date: date
    items:      List[InitialStockItem]

    @field_validator("items")
    @classmethod
    def items_not_empty(cls, v):
        if not v:
            raise ValueError("Harus ada minimal 1 item")
        return v


@router.get("/initial")
def get_initial_stock_status(user=Depends(get_current_user)):
    """Cek status initial stock + ingredient yang belum punya receipt history."""
    client = get_supabase_admin()

    rows = (
        client.table("goods_receipts")
        .select("id, received_date")
        .eq("is_initial_stock", True)
        .order("received_date")
        .execute()
        .data
    ) or []

    all_ings = client.table("ingredients").select("id").eq("is_active", True).execute().data or []
    all_ids = {r["id"] for r in all_ings}

    ri_rows = client.table("receipt_items").select("ingredient_id").limit(50000).execute().data or []
    covered_ids = {r["ingredient_id"] for r in ri_rows}

    pending_ids = sorted(all_ids - covered_ids)

    base = {"pending_count": len(pending_ids), "pending_ids": pending_ids}

    if not rows:
        return {**base, "has_initial_stock": False, "stock_date": None, "items_count": 0}

    receipt = rows[0]
    items = (
        client.table("receipt_items")
        .select("id", count="exact")
        .eq("receipt_id", receipt["id"])
        .execute()
    )
    return {
        **base,
        "has_initial_stock": True,
        "stock_date":        receipt["received_date"],
        "items_count":       items.count or 0,
    }


@router.post("/initial", status_code=status.HTTP_201_CREATED)
def create_initial_stock(body: InitialStockRequest, user=Depends(require_admin)):
    """
    Catat stok awal (opening balance). Bisa dipanggil berkali-kali — setiap kali
    hanya memproses ingredient yang BELUM punya receipt_items (bahan baru).

    PENTING: TIDAK memanggil update_avg_cost(). Harga tetap 0 di receipt_items
    (actual_price_per_unit=0) supaya avg_cost_per_unit ingredient tidak berubah.
    """
    client = get_supabase_admin()

    submitted_ids = list({it.ingredient_id for it in body.items})
    ri_rows = client.table("receipt_items").select("ingredient_id").in_("ingredient_id", submitted_ids).limit(50000).execute().data or []
    already_covered = {r["ingredient_id"] for r in ri_rows}

    new_items = [it for it in body.items if it.ingredient_id not in already_covered]
    if not new_items:
        raise HTTPException(400, "Semua bahan yang dikirim sudah memiliki riwayat stok/pembelian.")

    ing_ids  = list({it.ingredient_id for it in new_items})
    unit_ids = list({it.unit_id for it in new_items})

    existing_ings  = {r["id"] for r in client.table("ingredients").select("id").in_("id", ing_ids).execute().data}
    existing_units = {r["id"] for r in client.table("units").select("id").in_("id", unit_ids).execute().data}

    for it in new_items:
        if it.ingredient_id not in existing_ings:
            raise HTTPException(404, f"Ingredient {it.ingredient_id} tidak ditemukan")
        if it.unit_id not in existing_units:
            raise HTTPException(404, f"Unit {it.unit_id} tidak ditemukan")

    receipt = client.table("goods_receipts").insert({
        "received_by":      user["sub"],
        "received_date":    body.stock_date.isoformat(),
        "is_initial_stock": True,
        "notes":            "Stok awal (opening balance)",
    }).execute().data[0]
    receipt_id = receipt["id"]

    items_payload = [
        {
            "receipt_id":            receipt_id,
            "ingredient_id":         it.ingredient_id,
            "received_qty":          float(it.qty),
            "unit_id":               it.unit_id,
            "actual_price_per_unit": 0,
            "notes":                 "Initial stock",
        }
        for it in new_items
    ]
    client.table("receipt_items").insert(items_payload).execute()

    return {
        "receipt_id":   receipt_id,
        "items_count":  len(new_items),
        "message":      f"Stok awal berhasil dicatat untuk {len(new_items)} bahan",
    }


@router.delete("/initial")
def reset_initial_stock(user=Depends(require_admin)):
    """Hapus semua initial stock — untuk development/trial-and-error."""
    client = get_supabase_admin()

    receipts = client.table("goods_receipts").select("id").eq("is_initial_stock", True).execute().data or []
    if not receipts:
        raise HTTPException(400, "Tidak ada stok awal untuk dihapus.")

    for r in receipts:
        client.table("receipt_items").delete().eq("receipt_id", r["id"]).execute()
        client.table("goods_receipts").delete().eq("id", r["id"]).execute()

    return {"message": f"Stok awal berhasil direset ({len(receipts)} receipt dihapus)"}


@router.get("/initial/items")
def get_initial_stock_items(user=Depends(get_current_user)):
    """Daftar qty per ingredient dari initial stock receipts."""
    client = get_supabase_admin()
    receipts = client.table("goods_receipts").select("id").eq("is_initial_stock", True).execute().data or []
    if not receipts:
        return []
    items = (
        client.table("receipt_items")
        .select("ingredient_id, received_qty")
        .in_("receipt_id", [r["id"] for r in receipts])
        .limit(50000)
        .execute().data or []
    )
    agg = {}
    for it in items:
        agg[it["ingredient_id"]] = agg.get(it["ingredient_id"], 0) + float(it["received_qty"])
    return [{"ingredient_id": k, "qty": v} for k, v in agg.items()]


@router.delete("/initial/{ingredient_id}")
def reset_initial_stock_item(ingredient_id: str, user=Depends(require_admin)):
    """Reset stok awal satu ingredient — hapus receipt_items-nya."""
    client = get_supabase_admin()
    receipts = client.table("goods_receipts").select("id").eq("is_initial_stock", True).execute().data or []
    if not receipts:
        raise HTTPException(404, "Tidak ada stok awal")
    deleted = 0
    for rid in [r["id"] for r in receipts]:
        result = client.table("receipt_items").delete().eq("receipt_id", rid).eq("ingredient_id", ingredient_id).execute()
        deleted += len(result.data or [])
    if deleted == 0:
        raise HTTPException(404, "Ingredient tidak ditemukan di stok awal")
    for r in receipts:
        remaining = client.table("receipt_items").select("id", count="exact").eq("receipt_id", r["id"]).execute()
        if (remaining.count or 0) == 0:
            client.table("goods_receipts").delete().eq("id", r["id"]).execute()
    return {"message": "Stok awal bahan ini berhasil direset"}
