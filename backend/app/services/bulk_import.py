"""
Bulk import BOM dari Excel.
Format kolom: Menu | Bahan | Qty | Satuan

Flow:
  1. parse_preview() — baca Excel, validasi tiap baris, return preview + import_token
  2. commit_import(token) — ambil data dari cache in-memory, insert ke DB
"""
import uuid
from io import BytesIO
from typing import Any

import pandas as pd

from app.services.supabase import get_supabase_admin

REQUIRED_COLUMNS = {"Menu", "Bahan", "Qty", "Satuan"}

# Cache in-memory: import_token → list[valid_rows]
# Cukup untuk single-server; ganti Redis jika multi-instance nanti
_import_cache: dict[str, list[dict]] = {}


def _load_lookups() -> tuple[dict, dict, dict]:
    """Ambil semua nama menu, ingredient, unit dari DB (lowercase → id)."""
    client = get_supabase_admin()

    menus = client.table("menu_items").select("id, name").eq("is_active", True).execute().data
    menu_map = {r["name"].strip().lower(): r["id"] for r in menus}

    ings = client.table("ingredients").select("id, name").eq("is_active", True).execute().data
    ing_map = {r["name"].strip().lower(): r["id"] for r in ings}

    units = client.table("units").select("id, name").execute().data
    unit_map = {r["name"].strip().lower(): r["id"] for r in units}

    return menu_map, ing_map, unit_map


def parse_preview(file_bytes: bytes) -> dict[str, Any]:
    """
    Baca Excel, validasi tiap baris.
    Return: {success, errors, total_rows, success_count, error_count, import_token}
    """
    try:
        df = pd.read_excel(BytesIO(file_bytes), engine="openpyxl")
    except Exception as e:
        raise ValueError(f"File tidak bisa dibaca sebagai Excel: {e}")

    # Normalize kolom
    df.columns = [c.strip() for c in df.columns]
    missing = REQUIRED_COLUMNS - set(df.columns)
    if missing:
        raise ValueError(f"Kolom wajib tidak ditemukan: {sorted(missing)}")

    df = df[["Menu", "Bahan", "Qty", "Satuan"]].copy()
    df = df.dropna(how="all")  # skip baris kosong total

    menu_map, ing_map, unit_map = _load_lookups()

    success_rows: list[dict] = []
    error_rows: list[dict] = []

    for i, row in df.iterrows():
        row_num = int(i) + 2  # row Excel (header = baris 1)
        menu_raw = str(row["Menu"]).strip() if pd.notna(row["Menu"]) else ""
        bahan_raw = str(row["Bahan"]).strip() if pd.notna(row["Bahan"]) else ""
        satuan_raw = str(row["Satuan"]).strip() if pd.notna(row["Satuan"]) else ""
        qty_raw = row["Qty"]

        errors_this_row: list[str] = []

        # Validasi Menu
        menu_id = menu_map.get(menu_raw.lower())
        if not menu_raw:
            errors_this_row.append("Kolom Menu kosong")
        elif not menu_id:
            errors_this_row.append(f"Menu '{menu_raw}' tidak ditemukan di database")

        # Validasi Bahan
        ing_id = ing_map.get(bahan_raw.lower())
        if not bahan_raw:
            errors_this_row.append("Kolom Bahan kosong")
        elif not ing_id:
            errors_this_row.append(f"Bahan '{bahan_raw}' tidak ditemukan di database")

        # Validasi Qty
        try:
            qty = float(qty_raw)
            if qty <= 0:
                raise ValueError
        except (ValueError, TypeError):
            qty = None
            errors_this_row.append(f"Qty '{qty_raw}' tidak valid (harus angka > 0)")

        # Validasi Satuan
        unit_id = unit_map.get(satuan_raw.lower())
        if not satuan_raw:
            errors_this_row.append("Kolom Satuan kosong")
        elif not unit_id:
            errors_this_row.append(f"Satuan '{satuan_raw}' tidak ditemukan di database")

        if errors_this_row:
            error_rows.append({
                "row": row_num,
                "menu": menu_raw,
                "bahan": bahan_raw,
                "qty": str(qty_raw),
                "satuan": satuan_raw,
                "reasons": errors_this_row,
            })
        else:
            success_rows.append({
                "row": row_num,
                "menu_name": menu_raw,
                "ingredient_name": bahan_raw,
                "qty": qty,
                "unit_name": satuan_raw,
                "menu_id": menu_id,
                "ingredient_id": ing_id,
                "unit_id": unit_id,
            })

    import_token = str(uuid.uuid4())
    _import_cache[import_token] = success_rows

    return {
        "success": success_rows,
        "errors": error_rows,
        "total_rows": len(success_rows) + len(error_rows),
        "success_count": len(success_rows),
        "error_count": len(error_rows),
        "import_token": import_token,
    }


def commit_import(import_token: str) -> dict[str, Any]:
    """
    Eksekusi insert berdasarkan token preview.
    Per menu: DELETE existing recipes, INSERT baru (full replace).
    """
    rows = _import_cache.pop(import_token, None)
    if rows is None:
        raise ValueError("import_token tidak valid atau sudah kadaluarsa")

    if not rows:
        return {"inserted": 0, "menus_affected": 0, "errors": []}

    client = get_supabase_admin()
    menus_affected = set()
    inserted = 0
    errors: list[dict] = []

    # Group by menu_id untuk atomic replace per menu
    from itertools import groupby
    rows_sorted = sorted(rows, key=lambda r: r["menu_id"])

    for menu_id, group in groupby(rows_sorted, key=lambda r: r["menu_id"]):
        group_list = list(group)
        menu_name = group_list[0]["menu_name"]
        try:
            # Replace: hapus semua recipe lama untuk menu ini
            client.table("recipes").delete().eq("menu_id", menu_id).execute()

            # Insert semua baris baru sekaligus
            records = [
                {
                    "menu_id": menu_id,
                    "ingredient_id": r["ingredient_id"],
                    "qty": r["qty"],
                    "unit_id": r["unit_id"],
                }
                for r in group_list
            ]
            client.table("recipes").insert(records).execute()

            menus_affected.add(menu_id)
            inserted += len(records)
        except Exception as e:
            errors.append({"menu": menu_name, "reason": str(e)})

    return {
        "inserted": inserted,
        "menus_affected": len(menus_affected),
        "errors": errors,
    }
