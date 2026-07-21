"""
Goods Receipt router — konfirmasi penerimaan barang.

Saat POST /goods-receipts dikonfirmasi:
1. Insert goods_receipts header
2. Insert receipt_items (detail per ingredient)
3. Untuk setiap item: update_avg_cost() → update weighted avg + history + trigger HPP recalc
4. Jika ada po_id: update PO status ke 'received' atau 'partial'

goods_receipt bisa tanpa PO (emergency purchase): po_id opsional.

POST /goods-receipts/quick-entry — alur harian tanpa PO formal:
Barang langsung diterima + dicatat hari itu, tiap item punya po_category sendiri.
"""
import logging
from typing import Optional, List, Literal
from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, field_validator

from app.dependencies import require_admin, get_current_user
from app.services.supabase import get_supabase_admin
from app.services.avg_cost import update_avg_cost

logger = logging.getLogger(__name__)
router = APIRouter()

# ── Pydantic models ───────────────────────────────────────────────────────────

class ReceiptItemCreate(BaseModel):
    ingredient_id:         str
    received_qty:          Decimal
    unit_id:               str
    actual_price_per_unit: Decimal
    notes:                 Optional[str] = None

    @field_validator("received_qty")
    @classmethod
    def qty_non_negative(cls, v):
        if v < 0:
            raise ValueError("received_qty tidak boleh negatif")
        return v

    @field_validator("actual_price_per_unit")
    @classmethod
    def price_non_negative(cls, v):
        if v < 0:
            raise ValueError("actual_price_per_unit tidak boleh negatif")
        return v


class GoodsReceiptCreate(BaseModel):
    po_id:         Optional[str]       = None
    received_date: Optional[date]      = None
    notes:         Optional[str]       = None
    items:         List[ReceiptItemCreate]

    @field_validator("items")
    @classmethod
    def items_not_empty(cls, v):
        if not v:
            raise ValueError("Receipt harus memiliki minimal 1 item")
        return v


# ── Quick-entry models ────────────────────────────────────────────────────────

class QuickEntryItem(BaseModel):
    ingredient_id:         str
    vendor_id:             Optional[str]  = None
    po_category:           Literal[
        "storage_bar", "storage_kitchen", "kitchen", "bar", "staff_meal", "operational"
    ] = "kitchen"
    ordered_qty:           Decimal
    unit_id:               str
    actual_price_per_unit: Decimal
    notes:                 Optional[str] = None

    @field_validator("ordered_qty")
    @classmethod
    def qty_positive(cls, v):
        if v <= 0:
            raise ValueError("ordered_qty harus > 0")
        return v

    @field_validator("actual_price_per_unit")
    @classmethod
    def price_non_negative(cls, v):
        if v < 0:
            raise ValueError("actual_price_per_unit tidak boleh negatif")
        return v


class QuickEntryRequest(BaseModel):
    received_date:  date
    payment_date:   Optional[date]                          = None
    payment_status: Literal["unpaid", "paid"]               = "unpaid"
    notes:          Optional[str]                           = None
    items:          List[QuickEntryItem]

    @field_validator("items")
    @classmethod
    def items_not_empty(cls, v):
        if not v:
            raise ValueError("Harus ada minimal 1 item")
        return v

    @field_validator("payment_date")
    @classmethod
    def payment_date_when_paid(cls, v, info):
        # payment_date boleh null meskipun paid (dibayar tapi tanggal belum dicatat)
        return v


# ── Helpers ───────────────────────────────────────────────────────────────────

SELECT_RECEIPT = (
    "id, po_id, received_date, payment_date, payment_status, notes, created_at,"
    " received_by_user:users!received_by(id, name, email)"
)

SELECT_RECEIPT_ITEM = (
    "id, received_qty, actual_price_per_unit, total_price, notes, po_category,"
    " ingredient:ingredients!ingredient_id(id, name, ingredient_type, base_unit_id),"
    " unit:units!unit_id(id, name, symbol),"
    " vendor:vendors!vendor_id(id, name)"
)


def _flatten_receipt(r: dict) -> dict:
    user = r.pop("received_by_user", None) or {}
    r["received_by_name"]  = user.get("name")
    r["received_by_email"] = user.get("email")
    return r


def _flatten_receipt_item(r: dict) -> dict:
    ing    = r.pop("ingredient", None) or {}
    unit   = r.pop("unit", None) or {}
    vendor = r.pop("vendor", None) or {}
    r["ingredient_id"]     = ing.get("id")
    r["ingredient_name"]   = ing.get("name")
    r["ingredient_type"]   = ing.get("ingredient_type")
    r["unit_id"]           = unit.get("id")
    r["unit_name"]         = unit.get("name")
    r["unit_symbol"]       = unit.get("symbol")
    r["vendor_id"]         = vendor.get("id")
    r["vendor_name"]       = vendor.get("name")
    return r


def _get_receipt_or_404(receipt_id: str, client) -> dict:
    rows = (
        client.table("goods_receipts")
        .select(SELECT_RECEIPT)
        .eq("id", receipt_id)
        .execute()
        .data
    )
    if not rows:
        raise HTTPException(404, f"Receipt {receipt_id} tidak ditemukan")
    return _flatten_receipt(rows[0])


def _update_po_status_after_receipt(po_id: str, client) -> None:
    """
    Setelah barang diterima, cek apakah semua PO items sudah ter-cover
    oleh goods receipts → set PO ke 'received', otherwise 'partial'.

    Heuristic: cek apakah total receipt qty >= ordered_qty per ingredient.
    Karena unit bisa berbeda, ini approximation; cukup untuk operasional.
    """
    try:
        # Get PO items
        po_items = (
            client.table("po_items")
            .select("ingredient_id, ordered_qty, unit_id")
            .eq("po_id", po_id)
            .execute()
            .data
        )
        if not po_items:
            return

        # Get all receipt items for this PO's receipts
        receipt_ids = (
            client.table("goods_receipts")
            .select("id")
            .eq("po_id", po_id)
            .execute()
            .data
        )
        receipt_id_list = [r["id"] for r in receipt_ids]

        if not receipt_id_list:
            return

        receipt_items = (
            client.table("receipt_items")
            .select("ingredient_id, received_qty")
            .in_("receipt_id", receipt_id_list)
            .execute()
            .data
        )

        # Aggregate received qty per ingredient
        received_map: dict[str, float] = {}
        for ri in receipt_items:
            iid = ri["ingredient_id"]
            received_map[iid] = received_map.get(iid, 0) + float(ri["received_qty"])

        # Check if all PO items fully received (same-unit approximation)
        all_received = all(
            received_map.get(pi["ingredient_id"], 0) >= float(pi["ordered_qty"])
            for pi in po_items
        )

        new_status = "received" if all_received else "partial"
        current_status = (
            client.table("purchase_orders")
            .select("status")
            .eq("id", po_id)
            .execute()
            .data[0]["status"]
        )

        # Don't downgrade from received/cancelled
        if current_status in ("received", "cancelled"):
            return

        client.table("purchase_orders").update({"status": new_status}).eq("id", po_id).execute()
        logger.info("PO %s → status updated to %s", po_id, new_status)

    except Exception as exc:
        logger.warning("Failed to update PO status for %s: %s", po_id, exc)


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/quick-entry", status_code=status.HTTP_201_CREATED)
def quick_entry_purchase(body: QuickEntryRequest, user=Depends(require_admin)):
    """
    Alur harian: catat pembelian langsung tanpa PO formal.
    Barang sudah diterima hari itu — satu endpoint, satu kali submit.

    Per item: ingredient + vendor + po_category (kitchen/bar/staff_meal/operational) + qty + harga.
    Setelah insert: update weighted avg_cost + trigger HPP recalc seperti biasa.
    """
    client = get_supabase_admin()

    # Validate ingredient_ids, vendor_ids, unit_ids sekaligus
    ing_ids    = list({it.ingredient_id for it in body.items})
    unit_ids   = list({it.unit_id for it in body.items})
    vendor_ids = list({it.vendor_id for it in body.items if it.vendor_id})

    existing_ings_rows = client.table("ingredients").select("id, conversion_factor, base_unit_id").in_("id", ing_ids).execute().data
    existing_ings    = {r["id"]: r for r in existing_ings_rows}
    existing_units   = {r["id"] for r in client.table("units").select("id").in_("id", unit_ids).execute().data}
    existing_vendors = {r["id"] for r in client.table("vendors").select("id").in_("id", vendor_ids).execute().data} if vendor_ids else set()

    for it in body.items:
        if it.ingredient_id not in existing_ings:
            raise HTTPException(404, f"Ingredient {it.ingredient_id} tidak ditemukan")
        if it.unit_id not in existing_units:
            raise HTTPException(404, f"Unit {it.unit_id} tidak ditemukan")
        if it.vendor_id and it.vendor_id not in existing_vendors:
            raise HTTPException(404, f"Vendor {it.vendor_id} tidak ditemukan")

    # 1. Insert goods_receipts header (po_id = NULL — ad-hoc purchase)
    receipt_row = client.table("goods_receipts").insert({
        "received_by":     user["sub"],
        "received_date":   body.received_date.isoformat(),
        "payment_date":    body.payment_date.isoformat() if body.payment_date else None,
        "payment_status":  body.payment_status,
        "notes":           body.notes,
    }).execute().data[0]
    receipt_id = receipt_row["id"]

    # 2. Insert receipt_items — qty dikonversi ke base_unit via conversion_factor
    items_payload = []
    for it in body.items:
        cf = float(existing_ings[it.ingredient_id].get("conversion_factor") or 1)
        ledger_qty = float(it.ordered_qty) * cf
        price_per_base = float(it.actual_price_per_unit) / cf if cf else float(it.actual_price_per_unit)
        base_unit_id = existing_ings[it.ingredient_id]["base_unit_id"]
        payload = {
            "receipt_id":            receipt_id,
            "ingredient_id":         it.ingredient_id,
            "received_qty":          ledger_qty,
            "unit_id":               base_unit_id,
            "actual_price_per_unit": price_per_base,
            "po_category":           it.po_category,
        }
        if it.vendor_id:
            payload["vendor_id"] = it.vendor_id
        if it.notes:
            payload["notes"] = it.notes
        items_payload.append(payload)

    inserted_items = client.table("receipt_items").insert(items_payload).execute().data

    # Map ingredient_id → receipt_item_id (last one wins if duplicate ingredient)
    receipt_item_id_map = {ri["ingredient_id"]: ri["id"] for ri in inserted_items}

    # 3. Update avg_cost + trigger HPP recalc per item (qty/price sudah base_unit)
    avg_cost_results = []
    errors           = []
    all_recalculated = set()

    for it in body.items:
        try:
            cf = float(existing_ings[it.ingredient_id].get("conversion_factor") or 1)
            ledger_qty = float(it.ordered_qty) * cf
            price_per_base = float(it.actual_price_per_unit) / cf if cf else float(it.actual_price_per_unit)
            base_unit_id = existing_ings[it.ingredient_id]["base_unit_id"]
            result = update_avg_cost(
                ingredient_id      = it.ingredient_id,
                new_qty            = ledger_qty,
                new_price_per_unit = price_per_base,
                unit_id            = base_unit_id,
                receipt_item_id    = receipt_item_id_map.get(it.ingredient_id),
                client             = client,
            )
            avg_cost_results.append({
                "ingredient_id":   it.ingredient_id,
                "ingredient_name": result["ingredient_name"],
                "old_avg_cost":    result["old_avg_cost"],
                "new_avg_cost":    result["new_avg_cost"],
            })
            all_recalculated.update(result.get("menus_recalculated", []))
        except Exception as exc:
            logger.error("avg_cost failed for %s: %s", it.ingredient_id, exc)
            errors.append({"ingredient_id": it.ingredient_id, "error": str(exc)})

    # 4. Build per-category breakdown (pakai purchase qty × purchase price)
    by_category: dict[str, float] = {}
    total_amount = 0.0
    for it in body.items:
        amt = float(it.ordered_qty) * float(it.actual_price_per_unit)
        cat = it.po_category
        by_category[cat] = by_category.get(cat, 0.0) + amt
        total_amount += amt

    return {
        "receipt_id":             receipt_id,
        "items_count":            len(body.items),
        "total_amount":           round(total_amount),
        "by_category":            {k: round(v) for k, v in by_category.items()},
        "avg_cost_updates":       avg_cost_results,
        "menus_hpp_recalculated": len(all_recalculated),
        "errors":                 errors,
    }


@router.get("")
def list_goods_receipts(
    po_id:     Optional[str]  = Query(None),
    date_from: Optional[date] = Query(None),
    date_to:   Optional[date] = Query(None),
    limit:     int            = Query(50, ge=1, le=200),
    offset:    int            = Query(0, ge=0),
    user=Depends(get_current_user),
):
    """Daftar goods receipts, opsional filter per PO atau tanggal."""
    client = get_supabase_admin()
    q = client.table("goods_receipts").select(SELECT_RECEIPT, count="exact")

    if po_id:
        q = q.eq("po_id", po_id)
    if date_from:
        q = q.gte("received_date", date_from.isoformat())
    if date_to:
        q = q.lte("received_date", date_to.isoformat())

    res = q.order("received_date", desc=True).range(offset, offset + limit - 1).execute()
    return {
        "total":  res.count,
        "offset": offset,
        "limit":  limit,
        "data":   [_flatten_receipt(r) for r in res.data],
    }


@router.post("", status_code=status.HTTP_201_CREATED)
def create_goods_receipt(body: GoodsReceiptCreate, user=Depends(require_admin)):
    """
    Konfirmasi penerimaan barang.

    Untuk setiap item:
    1. Insert ke receipt_items
    2. Panggil update_avg_cost() → update weighted avg cost + history + trigger HPP recalc

    Setelah semua item diproses: jika ada po_id, update PO status ke partial/received.
    """
    client = get_supabase_admin()

    # Validate po_id if provided
    if body.po_id:
        po_rows = (
            client.table("purchase_orders")
            .select("id, status")
            .eq("id", body.po_id)
            .execute()
            .data
        )
        if not po_rows:
            raise HTTPException(404, f"PO {body.po_id} tidak ditemukan")
        if po_rows[0]["status"] == "cancelled":
            raise HTTPException(400, "Tidak bisa menerima barang untuk PO yang sudah cancelled")

    # Validate ingredient_ids and unit_ids
    ing_ids  = [it.ingredient_id for it in body.items]
    unit_ids = [it.unit_id       for it in body.items]

    existing_ings_rows = client.table("ingredients").select("id, conversion_factor, base_unit_id").in_("id", ing_ids).execute().data
    existing_ings  = {r["id"]: r for r in existing_ings_rows}
    existing_units = {r["id"] for r in client.table("units").select("id").in_("id", unit_ids).execute().data}

    for it in body.items:
        if it.ingredient_id not in existing_ings:
            raise HTTPException(404, f"Ingredient {it.ingredient_id} tidak ditemukan")
        if it.unit_id not in existing_units:
            raise HTTPException(404, f"Unit {it.unit_id} tidak ditemukan")

    # Insert goods_receipt header
    receipt_payload = {
        "received_by": user["sub"],
        "notes":       body.notes,
    }
    if body.po_id:
        receipt_payload["po_id"] = body.po_id
    if body.received_date:
        receipt_payload["received_date"] = body.received_date.isoformat()

    receipt_row = client.table("goods_receipts").insert(receipt_payload).execute().data[0]
    receipt_id  = receipt_row["id"]

    # Insert receipt_items — qty dikonversi ke base_unit via conversion_factor
    items_payload = []
    for it in body.items:
        cf = float(existing_ings[it.ingredient_id].get("conversion_factor") or 1)
        ledger_qty = float(it.received_qty) * cf
        price_per_base = float(it.actual_price_per_unit) / cf if cf else float(it.actual_price_per_unit)
        base_unit_id = existing_ings[it.ingredient_id]["base_unit_id"]
        items_payload.append({
            "receipt_id":            receipt_id,
            "ingredient_id":         it.ingredient_id,
            "received_qty":          ledger_qty,
            "unit_id":               base_unit_id,
            "actual_price_per_unit": price_per_base,
            "notes":                 it.notes,
        })
    inserted_items = client.table("receipt_items").insert(items_payload).execute().data

    # Build receipt_item_id map: ingredient_id → receipt_item_id
    receipt_item_id_map = {ri["ingredient_id"]: ri["id"] for ri in inserted_items}

    # Update avg_cost for each item + trigger HPP recalc (qty/price sudah base_unit)
    avg_cost_results = []
    errors = []
    all_recalculated_menus = set()

    for it in body.items:
        cf = float(existing_ings[it.ingredient_id].get("conversion_factor") or 1)
        ledger_qty = float(it.received_qty) * cf
        if ledger_qty == 0:
            continue
        price_per_base = float(it.actual_price_per_unit) / cf if cf else float(it.actual_price_per_unit)
        base_unit_id = existing_ings[it.ingredient_id]["base_unit_id"]
        try:
            result = update_avg_cost(
                ingredient_id     = it.ingredient_id,
                new_qty           = ledger_qty,
                new_price_per_unit= price_per_base,
                unit_id           = base_unit_id,
                receipt_item_id   = receipt_item_id_map.get(it.ingredient_id),
                client            = client,
            )
            avg_cost_results.append({
                "ingredient_id":   it.ingredient_id,
                "ingredient_name": result["ingredient_name"],
                "old_avg_cost":    result["old_avg_cost"],
                "new_avg_cost":    result["new_avg_cost"],
            })
            all_recalculated_menus.update(result.get("menus_recalculated", []))
        except Exception as exc:
            logger.error("avg_cost update failed for ingredient %s: %s", it.ingredient_id, exc)
            errors.append({"ingredient_id": it.ingredient_id, "error": str(exc)})

    # Update PO status if po_id provided
    if body.po_id:
        _update_po_status_after_receipt(body.po_id, client)

    # Return full receipt with items
    receipt = _get_receipt_or_404(receipt_id, client)
    receipt_items_rows = (
        client.table("receipt_items")
        .select(SELECT_RECEIPT_ITEM)
        .eq("receipt_id", receipt_id)
        .execute()
        .data
    )
    receipt["items"]                    = [_flatten_receipt_item(ri) for ri in receipt_items_rows]
    receipt["avg_cost_updates"]         = avg_cost_results
    receipt["menus_hpp_recalculated"]   = len(all_recalculated_menus)
    receipt["errors"]                   = errors

    if errors:
        logger.warning("Receipt %s processed with %d error(s): %s", receipt_id, len(errors), errors)

    return receipt


# ── Edit / hapus item belanja (koreksi salah input) ──────────────────────────
# avg_cost di-rekalkulasi penuh dari ingredient_cost_history setelah koreksi.
# SENGAJA tanpa guard stok negatif — koreksi membetulkan data yang salah,
# sama seperti stock_adjustments.

class ReceiptItemUpdate(BaseModel):
    received_qty:          Optional[Decimal] = None
    actual_price_per_unit: Optional[Decimal] = None
    po_category:           Optional[Literal[
        "storage_bar", "storage_kitchen", "kitchen", "bar", "staff_meal", "operational"
    ]] = None
    vendor_id:             Optional[str] = None
    notes:                 Optional[str] = None

    @field_validator("received_qty")
    @classmethod
    def qty_positive(cls, v):
        if v is not None and v <= 0:
            raise ValueError("received_qty harus > 0")
        return v

    @field_validator("actual_price_per_unit")
    @classmethod
    def price_non_negative(cls, v):
        if v is not None and v < 0:
            raise ValueError("actual_price_per_unit tidak boleh negatif")
        return v


def _get_item_or_404(item_id: str, client) -> dict:
    rows = (
        client.table("receipt_items")
        .select("*, receipt:goods_receipts!receipt_id(id, is_initial_stock)")
        .eq("id", item_id)
        .execute()
        .data
    )
    if not rows:
        raise HTTPException(404, "Item belanja tidak ditemukan")
    item = rows[0]
    if (item.get("receipt") or {}).get("is_initial_stock"):
        raise HTTPException(400, "Item initial stock — koreksi lewat halaman Stok Awal")
    return item


@router.get("/items")
def list_receipt_items_by_date(
    target_date: date = Query(..., alias="date"),
    user=Depends(get_current_user),
):
    """Semua item belanja pada satu tanggal (untuk riwayat + koreksi). Initial stock di-exclude."""
    client = get_supabase_admin()
    receipts = (
        client.table("goods_receipts")
        .select("id, is_initial_stock, payment_status, payment_date")
        .eq("received_date", target_date.isoformat())
        .execute()
        .data
    ) or []
    receipt_map = {r["id"]: r for r in receipts if not r.get("is_initial_stock")}
    if not receipt_map:
        return []
    items = (
        client.table("receipt_items")
        .select(SELECT_RECEIPT_ITEM + ", receipt_id")
        .in_("receipt_id", list(receipt_map))
        .order("id")
        .execute()
        .data
    ) or []
    result = []
    for ri in items:
        item = _flatten_receipt_item(ri)
        receipt = receipt_map.get(item["receipt_id"]) or {}
        item["payment_status"] = receipt.get("payment_status")
        item["payment_date"]   = receipt.get("payment_date")
        result.append(item)
    return result


@router.put("/items/{item_id}")
def update_receipt_item(item_id: str, body: ReceiptItemUpdate, user=Depends(require_admin)):
    """Koreksi item belanja. Qty/harga berubah → history diupdate + avg_cost direkalkulasi."""
    from app.services.avg_cost import _get_conversion_factor, recompute_avg_cost_from_history

    client = get_supabase_admin()
    item = _get_item_or_404(item_id, client)

    data = {}
    if body.received_qty is not None:
        data["received_qty"] = float(body.received_qty)
    if body.actual_price_per_unit is not None:
        data["actual_price_per_unit"] = float(body.actual_price_per_unit)
    if body.po_category is not None:
        data["po_category"] = body.po_category
    if body.vendor_id is not None:
        data["vendor_id"] = body.vendor_id or None
    if body.notes is not None:
        data["notes"] = body.notes or None
    if not data:
        raise HTTPException(422, "Tidak ada field yang diupdate")

    client.table("receipt_items").update(data).eq("id", item_id).execute()

    result = {"item_id": item_id, "updated": list(data.keys())}
    if "received_qty" in data or "actual_price_per_unit" in data:
        ing = (
            client.table("ingredients")
            .select("base_unit_id")
            .eq("id", item["ingredient_id"])
            .single()
            .execute()
            .data
        )
        factor     = _get_conversion_factor(item["unit_id"], ing["base_unit_id"], client)
        qty        = data.get("received_qty", float(item["received_qty"]))
        price      = data.get("actual_price_per_unit", float(item["actual_price_per_unit"]))
        client.table("ingredient_cost_history").update({
            "qty_received":   qty * factor,
            "price_per_unit": (price / factor) if factor else price,
        }).eq("receipt_item_id", item_id).execute()

        recalc = recompute_avg_cost_from_history(item["ingredient_id"], client)
        result["new_avg_cost"] = recalc["new_avg_cost"]

    return result


@router.delete("/items/{item_id}")
def delete_receipt_item(item_id: str, user=Depends(require_admin)):
    """Hapus item belanja yang salah input. History ikut dihapus, avg_cost direkalkulasi."""
    from app.services.avg_cost import recompute_avg_cost_from_history

    client = get_supabase_admin()
    item = _get_item_or_404(item_id, client)
    receipt_id = item["receipt_id"]

    client.table("ingredient_cost_history").delete().eq("receipt_item_id", item_id).execute()
    client.table("receipt_items").delete().eq("id", item_id).execute()

    remaining = (
        client.table("receipt_items")
        .select("id", count="exact")
        .eq("receipt_id", receipt_id)
        .execute()
    )
    if (remaining.count or 0) == 0:
        client.table("goods_receipts").delete().eq("id", receipt_id).execute()

    recalc = recompute_avg_cost_from_history(item["ingredient_id"], client)
    return {"message": "Item belanja dihapus", "new_avg_cost": recalc["new_avg_cost"]}


class ItemPaymentUpdate(BaseModel):
    payment_status: str          # 'paid' | 'unpaid'
    payment_date:   date | None = None


@router.put("/items/{item_id}/payment")
def update_item_payment(item_id: str, body: ItemPaymentUpdate, user=Depends(require_admin)):
    """
    Ubah status pembayaran SATU item (mis. hutang kemarin baru dibayar hari ini).

    Payment status tersimpan di goods_receipts. Kalau receipt masih punya item lain
    (yang statusnya tidak ikut berubah), item ini di-split ke receipt baru supaya
    status pembayaran tetap per barang.
    """
    if body.payment_status not in ("paid", "unpaid"):
        raise HTTPException(400, "payment_status harus 'paid' atau 'unpaid'")

    client = get_supabase_admin()
    item = _get_item_or_404(item_id, client)
    receipt_id = item["receipt_id"]

    receipt = (
        client.table("goods_receipts")
        .select("*")
        .eq("id", receipt_id)
        .single()
        .execute()
        .data
    )

    if body.payment_status == "paid":
        pay_date = body.payment_date.isoformat() if body.payment_date else receipt["received_date"]
    else:
        pay_date = None

    siblings = (
        client.table("receipt_items")
        .select("id", count="exact")
        .eq("receipt_id", receipt_id)
        .neq("id", item_id)
        .execute()
    )

    if (siblings.count or 0) == 0:
        client.table("goods_receipts").update(
            {"payment_status": body.payment_status, "payment_date": pay_date}
        ).eq("id", receipt_id).execute()
        target_receipt_id = receipt_id
    else:
        new_receipt = client.table("goods_receipts").insert({
            "received_by":    receipt["received_by"],
            "received_date":  receipt["received_date"],
            "payment_status": body.payment_status,
            "payment_date":   pay_date,
            "po_id":          receipt.get("po_id"),
            "notes":          receipt.get("notes"),
        }).execute().data[0]
        client.table("receipt_items").update(
            {"receipt_id": new_receipt["id"]}
        ).eq("id", item_id).execute()
        target_receipt_id = new_receipt["id"]

    logger.info(
        "Payment item %s → %s (receipt %s%s)",
        item_id, body.payment_status, target_receipt_id,
        ", split dari " + receipt_id if target_receipt_id != receipt_id else "",
    )
    return {
        "message":        "Status pembayaran diubah",
        "receipt_id":     target_receipt_id,
        "payment_status": body.payment_status,
        "payment_date":   pay_date,
    }


@router.get("/{receipt_id}")
def get_goods_receipt(receipt_id: str, user=Depends(get_current_user)):
    """Detail goods receipt beserta semua item-nya."""
    client = get_supabase_admin()
    receipt = _get_receipt_or_404(receipt_id, client)

    items = (
        client.table("receipt_items")
        .select(SELECT_RECEIPT_ITEM)
        .eq("receipt_id", receipt_id)
        .execute()
        .data
    )
    receipt["items"] = [_flatten_receipt_item(ri) for ri in items]
    receipt["total_value"] = sum(float(ri.get("total_price") or 0) for ri in receipt["items"])
    return receipt
