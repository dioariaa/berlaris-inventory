from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from typing import Optional
from pydantic import BaseModel, Field

from app.models.menu import MenuCreate, MenuUpdate, MenuResponse
from app.models.recipe import RecipeItemResponse, RecipeSetRequest, BulkImportConfirm, RecipeItemIn
from app.dependencies import require_admin, get_current_user
from app.services.supabase import get_supabase_admin

router = APIRouter()

SELECT_RECIPE = (
    "id, menu_id, ingredient_id, qty, unit_id, notes, created_at, updated_at,"
    " ingredient:ingredients!ingredient_id(name, ingredient_type),"
    " unit:units!unit_id(name, symbol)"
)


def _serialize(body: MenuCreate | MenuUpdate) -> dict:
    return body.model_dump(exclude_none=True, mode="json")


def _flatten_recipe(r: dict) -> dict:
    ing = r.pop("ingredient", None) or {}
    unit = r.pop("unit", None) or {}
    r["ingredient_name"] = ing.get("name", "")
    r["ingredient_type"] = ing.get("ingredient_type", "")
    r["unit_name"] = unit.get("name", "")
    r["unit_symbol"] = unit.get("symbol", "")
    return r


def _md(resp):
    """`.maybe_single().execute()` returns None (not a response) on zero rows in
    this postgrest version, so `.data` would raise. Normalize to data-or-None."""
    return resp.data if resp else None


# ─────────────────────────────────────────────
# MENU CRUD
# ─────────────────────────────────────────────

@router.get("/active-today", response_model=list[MenuResponse])
def active_menus_today(user=Depends(get_current_user)):
    """Query view active_menus_today — menu yang tampil di Sales Entry hari ini."""
    return get_supabase_admin().table("active_menus_today").select("*").execute().data


@router.get("/", response_model=list[MenuResponse])
def list_menus(
    category: Optional[str] = Query(None),
    division: Optional[str] = Query(None, description="kitchen | bar"),
    active: bool = Query(True),
    seasonal: Optional[bool] = Query(None),
    search: Optional[str] = Query(None),
    user=Depends(get_current_user),
):
    q = get_supabase_admin().table("menu_items").select("*").eq("is_active", active)
    if category:
        q = q.eq("category", category)
    if division:
        q = q.eq("division", division)
    if seasonal is not None:
        q = q.eq("is_seasonal", seasonal)
    if search:
        q = q.ilike("name", f"%{search}%")
    return q.order("division").order("category").order("name").execute().data


@router.get("/availability")
def get_menu_availability(
    division: Optional[str] = Query(None, description="kitchen | bar"),
    user=Depends(get_current_user),
):
    """
    Ketersediaan tiap menu aktif berdasarkan stok bahan (current_stock, pure ledger).

    Untuk setiap menu: cari ingredient BOM dengan stok paling sedikit relatif
    kebutuhan per porsi (bottleneck), lalu hitung berapa porsi maksimal yang
    masih bisa dibuat dari stok tersebut.

    status: 'unavailable' (max_portions <= 0) | 'low' (1-5 porsi) | 'available' (>5 porsi)
    """
    from app.services.stock_level import get_current_stock

    client = get_supabase_admin()

    menus_q = client.table("menu_items").select("id, name, selling_price, division").eq("is_active", True)
    if division:
        menus_q = menus_q.eq("division", division)
    menus = menus_q.execute().data or []
    if not menus:
        return []

    menu_ids = [m["id"] for m in menus]

    recipes = (
        client.table("recipes")
        .select("menu_id, ingredient_id, qty")
        .in_("menu_id", menu_ids)
        .execute()
        .data
    ) or []

    ingredient_ids = list({r["ingredient_id"] for r in recipes})
    stock_rows = get_current_stock(ingredient_ids, client) if ingredient_ids else []
    stock_map = {s["ingredient_id"]: s for s in stock_rows}

    recipes_by_menu: dict[str, list[dict]] = {}
    for r in recipes:
        recipes_by_menu.setdefault(r["menu_id"], []).append(r)

    results = []
    for m in menus:
        menu_recipes = recipes_by_menu.get(m["id"], [])
        if not menu_recipes:
            results.append({
                "menu_id":                       m["id"],
                "menu_name":                     m["name"],
                "selling_price":                 float(m["selling_price"] or 0),
                "division":                      m["division"],
                "status":                        "unavailable",
                "max_portions":                  0,
                "bottleneck_ingredient":          None,
                "bottleneck_stock":               None,
                "bottleneck_needed_per_portion":  None,
                "bottleneck_unit":                None,
                "message":                       "Menu belum punya resep (BOM)",
            })
            continue

        min_portions = None
        bottleneck = None
        for r in menu_recipes:
            iid         = r["ingredient_id"]
            qty_needed  = float(r["qty"])
            if qty_needed <= 0:
                continue
            stock_info    = stock_map.get(iid)
            # Hanya stok DIVISION yang bisa dipakai — storage harus ditransfer dulu
            current_stock = stock_info["division_stock"] if stock_info else 0.0
            portions      = current_stock / qty_needed

            if min_portions is None or portions < min_portions:
                min_portions = portions
                bottleneck = {
                    "ingredient_name":     stock_info["ingredient_name"] if stock_info else iid,
                    "current_stock":       current_stock,
                    "needed_per_portion":  qty_needed,
                    "unit_symbol":         stock_info.get("unit_symbol") if stock_info else None,
                }

        max_portions = int(min_portions) if min_portions is not None else 0
        if max_portions <= 0:
            status_ = "unavailable"
        elif max_portions <= 5:
            status_ = "low"
        else:
            status_ = "available"

        results.append({
            "menu_id":                       m["id"],
            "menu_name":                     m["name"],
            "selling_price":                 float(m["selling_price"] or 0),
            "division":                      m["division"],
            "status":                        status_,
            "max_portions":                  max_portions,
            "bottleneck_ingredient":         bottleneck["ingredient_name"] if bottleneck else None,
            "bottleneck_stock":              round(bottleneck["current_stock"], 2) if bottleneck else None,
            "bottleneck_needed_per_portion": bottleneck["needed_per_portion"] if bottleneck else None,
            "bottleneck_unit":               bottleneck["unit_symbol"] if bottleneck else None,
        })

    return results


@router.get("/{menu_id}", response_model=MenuResponse)
def get_menu(menu_id: str, user=Depends(get_current_user)):
    result = _md(
        get_supabase_admin()
        .table("menu_items")
        .select("*")
        .eq("id", menu_id)
        .maybe_single()
        .execute()
    )
    if not result:
        raise HTTPException(status_code=404, detail="Menu tidak ditemukan")
    return result


@router.post("/", response_model=MenuResponse, status_code=status.HTTP_201_CREATED)
def create_menu(body: MenuCreate, user=Depends(require_admin)):
    try:
        result = get_supabase_admin().table("menu_items").insert(_serialize(body)).execute()
        return result.data[0]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/{menu_id}", response_model=MenuResponse)
def update_menu(menu_id: str, body: MenuUpdate, user=Depends(require_admin)):
    client = get_supabase_admin()
    existing = _md(client.table("menu_items").select("*").eq("id", menu_id).maybe_single().execute())
    if not existing:
        raise HTTPException(status_code=404, detail="Menu tidak ditemukan")

    data = _serialize(body)
    if not data:
        raise HTTPException(status_code=422, detail="Tidak ada field yang diupdate")

    merged_seasonal = data.get("is_seasonal", existing["is_seasonal"])
    merged_from = data.get("valid_from", existing.get("valid_from"))
    merged_until = data.get("valid_until", existing.get("valid_until"))

    if merged_seasonal and merged_from and merged_until and merged_from > merged_until:
        raise HTTPException(status_code=422, detail="valid_from harus <= valid_until")
    if not merged_seasonal:
        data["valid_from"] = None
        data["valid_until"] = None

    result = client.table("menu_items").update(data).eq("id", menu_id).execute()
    return result.data[0]


@router.delete("/{menu_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_menu(menu_id: str, user=Depends(require_admin)):
    client = get_supabase_admin()
    existing = _md(client.table("menu_items").select("id").eq("id", menu_id).maybe_single().execute())
    if not existing:
        raise HTTPException(status_code=404, detail="Menu tidak ditemukan")
    client.table("menu_items").update({"is_active": False}).eq("id", menu_id).execute()


# ─────────────────────────────────────────────
# RECIPE / BOM
# ─────────────────────────────────────────────

@router.get("/{menu_id}/recipe", response_model=list[RecipeItemResponse])
def get_recipe(menu_id: str, user=Depends(get_current_user)):
    # Pastikan menu ada
    menu = _md(
        get_supabase_admin()
        .table("menu_items").select("id").eq("id", menu_id).maybe_single().execute()
    )
    if not menu:
        raise HTTPException(status_code=404, detail="Menu tidak ditemukan")

    rows = (
        get_supabase_admin()
        .table("recipes")
        .select(SELECT_RECIPE)
        .eq("menu_id", menu_id)
        .order("ingredient_id")
        .execute()
        .data
    )
    return [_flatten_recipe(r) for r in rows]


@router.post("/{menu_id}/recipe", response_model=list[RecipeItemResponse])
def set_recipe(menu_id: str, body: RecipeSetRequest, user=Depends(require_admin)):
    """
    Replace seluruh BOM menu. DELETE semua recipe lama, INSERT yang baru.
    Atomik per menu — kalau INSERT gagal, menu tidak punya recipe.
    """
    client = get_supabase_admin()

    # Pastikan menu ada
    menu = _md(client.table("menu_items").select("id").eq("id", menu_id).maybe_single().execute())
    if not menu:
        raise HTTPException(status_code=404, detail="Menu tidak ditemukan")

    # Validasi semua ingredient_id dan unit_id sebelum commit
    errors = []
    for i, item in enumerate(body.items):
        ing = _md(client.table("ingredients").select("id").eq("id", item.ingredient_id).maybe_single().execute())
        if not ing:
            errors.append(f"Item {i+1}: ingredient_id '{item.ingredient_id}' tidak ditemukan")
        unit = _md(client.table("units").select("id").eq("id", item.unit_id).maybe_single().execute())
        if not unit:
            errors.append(f"Item {i+1}: unit_id '{item.unit_id}' tidak ditemukan")

    if errors:
        raise HTTPException(status_code=422, detail={"validation_errors": errors})

    # Replace
    client.table("recipes").delete().eq("menu_id", menu_id).execute()

    if body.items:
        records = [
            {
                "menu_id": menu_id,
                "ingredient_id": item.ingredient_id,
                "qty": float(item.qty),
                "unit_id": item.unit_id,
                "notes": item.notes,
            }
            for item in body.items
        ]
        client.table("recipes").insert(records).execute()

    # Return recipe baru dengan join
    rows = (
        client.table("recipes")
        .select(SELECT_RECIPE)
        .eq("menu_id", menu_id)
        .order("ingredient_id")
        .execute()
        .data
    )
    return [_flatten_recipe(r) for r in rows]


# ─────────────────────────────────────────────
# RECIPE GRAMASI EDIT
# ─────────────────────────────────────────────

class RecipeQtyUpdate(BaseModel):
    new_qty: float = Field(gt=0)
    reason: str = Field(min_length=5, description="Alasan perubahan (wajib, min 5 karakter)")


@router.put("/{menu_id}/recipe/{ingredient_id}/qty")
def update_recipe_qty(
    menu_id: str,
    ingredient_id: str,
    body: RecipeQtyUpdate,
    user=Depends(require_admin),
):
    """
    Edit gramasi satu ingredient dalam BOM.
    Wajib isi reason (min 5 char).
    Mencatat perubahan ke recipe_change_log.
    TIDAK mempengaruhi data historis theoretical_consumption.
    """
    client = get_supabase_admin()

    # Cari recipe yang ada
    recipe = _md(
        client.table("recipes")
        .select("id, qty, menu_id, ingredient_id")
        .eq("menu_id", menu_id)
        .eq("ingredient_id", ingredient_id)
        .maybe_single()
        .execute()
    )
    if not recipe:
        raise HTTPException(status_code=404, detail="Recipe item tidak ditemukan")

    old_qty = float(recipe["qty"])
    new_qty = round(body.new_qty, 3)

    if abs(old_qty - new_qty) < 0.001:
        raise HTTPException(status_code=400, detail="Qty tidak berubah")

    # Update recipes
    client.table("recipes").update({"qty": new_qty}).eq("id", recipe["id"]).execute()

    # Catat ke recipe_change_log
    client.table("recipe_change_log").insert({
        "recipe_id":     recipe["id"],
        "menu_id":       menu_id,
        "ingredient_id": ingredient_id,
        "old_qty":       old_qty,
        "new_qty":       new_qty,
        "changed_by":    user["sub"],
        "reason":        body.reason,
        "action":        "qty_change",
    }).execute()

    # Recalc HPP (best effort — tidak fatal jika gagal)
    try:
        from app.services.hpp import recalc_hpp
        new_hpp = recalc_hpp(menu_id, client=client)
    except Exception:
        new_hpp = None

    return {
        "menu_id":        menu_id,
        "ingredient_id":  ingredient_id,
        "recipe_id":      recipe["id"],
        "old_qty":        old_qty,
        "new_qty":        new_qty,
        "new_hpp":        new_hpp,
        "message":        "Gramasi berhasil diperbarui",
    }


@router.get("/{menu_id}/recipe/history")
def recipe_history(
    menu_id: str,
    ingredient_id: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=200),
    user=Depends(get_current_user),
):
    """Audit trail perubahan gramasi BOM untuk satu menu."""
    client = get_supabase_admin()

    q = (
        client.table("recipe_change_log")
        .select(
            "id, old_qty, new_qty, reason, action, changed_at,"
            "ingredient:ingredients!ingredient_id(name),"
            "changed_by_user:users!changed_by(name, email)"
        )
        .eq("menu_id", menu_id)
        .order("changed_at", desc=True)
        .limit(limit)
    )
    if ingredient_id:
        q = q.eq("ingredient_id", ingredient_id)

    rows = q.execute().data or []

    def _flatten(row):
        ing       = row.pop("ingredient", None) or {}
        user_info = row.pop("changed_by_user", None) or {}
        row["ingredient_name"] = ing.get("name")
        row["changed_by_name"] = user_info.get("name") or user_info.get("email") or "—"
        row.setdefault("action", "qty_change")  # backward compat sebelum migration
        return row

    return [_flatten(r) for r in rows]


# ─────────────────────────────────────────────
# RECIPE ITEM — ADD SINGLE INGREDIENT
# ─────────────────────────────────────────────

@router.post("/{menu_id}/recipe/items", response_model=RecipeItemResponse, status_code=status.HTTP_201_CREATED)
def add_recipe_item(
    menu_id: str,
    body: RecipeItemIn,
    user=Depends(require_admin),
):
    """
    Tambah satu ingredient ke BOM tanpa menghapus yang lain.
    Trigger HPP recalc.
    Catat ke recipe_change_log dengan action='ingredient_added'.
    """
    client = get_supabase_admin()

    # Pastikan menu ada
    menu = _md(client.table("menu_items").select("id").eq("id", menu_id).maybe_single().execute())
    if not menu:
        raise HTTPException(status_code=404, detail="Menu tidak ditemukan")

    # Validasi ingredient
    ing = _md(
        client.table("ingredients")
        .select("id, name")
        .eq("id", str(body.ingredient_id))
        .maybe_single()
        .execute()
    )
    if not ing:
        raise HTTPException(status_code=422, detail="ingredient_id tidak ditemukan")

    # Validasi unit
    unit = _md(client.table("units").select("id").eq("id", str(body.unit_id)).maybe_single().execute())
    if not unit:
        raise HTTPException(status_code=422, detail="unit_id tidak ditemukan")

    # Cek duplikat — zero rows (None) = tidak duplikat, ini happy path
    dup = _md(
        client.table("recipes")
        .select("id")
        .eq("menu_id", menu_id)
        .eq("ingredient_id", str(body.ingredient_id))
        .maybe_single()
        .execute()
    )
    if dup:
        raise HTTPException(status_code=409, detail=f"{ing['name']} sudah ada dalam resep ini")

    # Insert
    row = {
        "menu_id":       menu_id,
        "ingredient_id": str(body.ingredient_id),
        "qty":           float(body.qty),
        "unit_id":       str(body.unit_id),
        "notes":         body.notes,
    }
    new_recipe = client.table("recipes").insert(row).execute().data[0]

    # Audit log
    client.table("recipe_change_log").insert({
        "recipe_id":     new_recipe["id"],
        "menu_id":       menu_id,
        "ingredient_id": str(body.ingredient_id),
        "old_qty":       0,
        "new_qty":       float(body.qty),
        "changed_by":    user["sub"],
        "reason":        "Bahan baru ditambahkan ke resep",
        "action":        "ingredient_added",
    }).execute()

    # HPP recalc (best effort)
    try:
        from app.services.hpp import recalc_hpp
        recalc_hpp(menu_id, client=client)
    except Exception:
        pass

    # Return dengan join
    row_with_join = (
        client.table("recipes")
        .select(SELECT_RECIPE)
        .eq("id", new_recipe["id"])
        .single()
        .execute()
        .data
    )
    return _flatten_recipe(row_with_join)


# ─────────────────────────────────────────────
# RECIPE ITEM — DELETE SINGLE INGREDIENT
# ─────────────────────────────────────────────

@router.delete("/{menu_id}/recipe/{ingredient_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_recipe_item(
    menu_id: str,
    ingredient_id: str,
    user=Depends(require_admin),
):
    """
    Hapus satu ingredient dari BOM.
    Tidak bisa menghapus jika ini adalah ingredient terakhir.
    Catat ke recipe_change_log dengan action='ingredient_removed'.
    """
    client = get_supabase_admin()

    # Cek menu ada
    menu = _md(client.table("menu_items").select("id").eq("id", menu_id).maybe_single().execute())
    if not menu:
        raise HTTPException(status_code=404, detail="Menu tidak ditemukan")

    # Cek recipe item ada
    recipe = _md(
        client.table("recipes")
        .select("id, qty")
        .eq("menu_id", menu_id)
        .eq("ingredient_id", ingredient_id)
        .maybe_single()
        .execute()
    )
    if not recipe:
        raise HTTPException(status_code=404, detail="Bahan tidak ditemukan dalam resep ini")

    # Cek bukan ingredient terakhir
    total = (
        client.table("recipes")
        .select("id", count="exact")
        .eq("menu_id", menu_id)
        .execute()
        .count
    )
    if total is not None and total <= 1:
        raise HTTPException(
            status_code=400,
            detail="Tidak bisa menghapus bahan terakhir dalam resep. Gunakan 'Set Recipe' untuk mengganti seluruh BOM."
        )

    # Audit log — recipe_id=None karena recipe row akan dihapus. Kolom nullable
    # by design; history tetap terlacak via menu_id + ingredient_id.
    client.table("recipe_change_log").insert({
        "recipe_id":     None,
        "menu_id":       menu_id,
        "ingredient_id": ingredient_id,
        "old_qty":       float(recipe["qty"]),
        "new_qty":       0,
        "changed_by":    user["sub"],
        "reason":        "Bahan dihapus dari resep",
        "action":        "ingredient_removed",
    }).execute()

    # Lepaskan FK dari audit rows lama (mis. ingredient_added) supaya DELETE tidak
    # melanggar recipe_change_log_recipe_id_fkey (FK RESTRICT, recipe_id nullable).
    client.table("recipe_change_log").update({"recipe_id": None}).eq("recipe_id", recipe["id"]).execute()

    # Delete recipe item
    client.table("recipes").delete().eq("id", recipe["id"]).execute()

    # HPP recalc (best effort)
    try:
        from app.services.hpp import recalc_hpp
        recalc_hpp(menu_id, client=client)
    except Exception:
        pass


# ─────────────────────────────────────────────
# BULK IMPORT
# ─────────────────────────────────────────────

@router.post("/bulk-import/preview")
async def bulk_import_preview(
    file: UploadFile = File(...),
    user=Depends(require_admin),
):
    """
    Upload Excel → validasi tiap baris → return preview.
    Tidak ada yang di-insert sampai /bulk-import/confirm dipanggil.
    """
    if not file.filename or not file.filename.endswith(".xlsx"):
        raise HTTPException(status_code=422, detail="File harus berformat .xlsx")

    from app.services.bulk_import import parse_preview
    try:
        content = await file.read()
        result = parse_preview(content)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))

    return result


@router.post("/bulk-import/confirm")
def bulk_import_confirm(body: BulkImportConfirm, user=Depends(require_admin)):
    """
    Commit hasil preview yang sudah divalidasi.
    Token hanya valid sekali — habis dipakai langsung dihapus dari cache.
    """
    from app.services.bulk_import import commit_import
    try:
        result = commit_import(body.import_token)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    return result
