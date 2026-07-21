from fastapi import APIRouter, Depends, HTTPException, Query, status
from datetime import date
from decimal import Decimal
from collections import defaultdict
from typing import Optional

from app.models.sales_entry import (
    SalesEntrySubmit,
    SalesEntryTodayResponse,
    MenuGroupByCategory,
    MenuWithQty,
    SalesEntrySummary,
)
from app.dependencies import require_admin, get_current_user
from app.services.supabase import get_supabase_admin
from app.services.consumption import calculate_theoretical_consumption
from app.services.stock_guard import InsufficientStockError

router = APIRouter()

# Label display yang rapi untuk setiap kategori
CATEGORY_ORDER = [
    "breakfast", "snack", "main_course", "soup", "burger_sandwich",
    "pasta", "salad", "dessert", "rice_bowl",
    "coffee","manual brew", "tea","chocolate","Matcha","Milkshake","Jus", "mocktail", "other",
]


# ── GET /sales-entry/today ────────────────────────────────────────────────────

@router.get("/today", response_model=SalesEntryTodayResponse)
def get_sales_entry_today(
    entry_date: Optional[date] = Query(None, description="Default: hari ini"),
    user=Depends(get_current_user),
):
    """
    Ambil daftar menu aktif hari ini beserta qty yang sudah di-input.
    Dikelompokkan per kategori dengan urutan yang konsisten.
    """
    client = get_supabase_admin()
    target_date = entry_date or date.today()
    date_str = target_date.isoformat()

    # 1. Semua menu aktif hari ini (pakai view yang sudah handle seasonal logic)
    menus = client.table("active_menus_today").select(
        "id, name, category, division, selling_price"
    ).execute().data

    if not menus:
        return SalesEntryTodayResponse(
            entry_date=target_date,
            groups=[],
            total_menu_types=0,
            total_filled=0,
        )

    # 2. Ambil semua entries yang sudah ada untuk tanggal ini (semua entry_type)
    menu_ids = [m["id"] for m in menus]
    existing = (
        client.table("daily_sales_entries")
        .select("id, menu_id, qty_sold, entry_type")
        .eq("entry_date", date_str)
        .in_("menu_id", menu_ids)
        .execute()
        .data
    )

    # Build lookup: menu_id → {entry_type → {id, qty_sold}}
    entry_lookup: dict[str, dict] = defaultdict(dict)
    for e in existing:
        entry_lookup[e["menu_id"]][e.get("entry_type", "sale")] = e

    # 3. Gabungkan dan kelompokkan per kategori
    groups_map: dict[str, list[MenuWithQty]] = defaultdict(list)

    for m in menus:
        by_type = entry_lookup.get(m["id"], {})
        sale_e  = by_type.get("sale")
        comp_e  = by_type.get("complimentary")
        test_e  = by_type.get("test")
        groups_map[m["category"]].append(
            MenuWithQty(
                menu_id=m["id"],
                name=m["name"],
                category=m["category"],
                selling_price=Decimal(str(m["selling_price"])),
                qty_sale=int(sale_e["qty_sold"]) if sale_e else 0,
                qty_complimentary=int(comp_e["qty_sold"]) if comp_e else 0,
                qty_test=int(test_e["qty_sold"]) if test_e else 0,
                entry_id_sale=sale_e["id"] if sale_e else None,
                entry_id_complimentary=comp_e["id"] if comp_e else None,
                entry_id_test=test_e["id"] if test_e else None,
            )
        )

    # 4. Susun dalam urutan kategori yang konsisten
    ordered_keys = [k for k in CATEGORY_ORDER if k in groups_map]
    for k in groups_map:
        if k not in ordered_keys:
            ordered_keys.append(k)

    groups = [
        MenuGroupByCategory(category=cat, menus=groups_map[cat])
        for cat in ordered_keys
    ]

    total_filled = sum(
        1 for ets in entry_lookup.values()
        if any(int(e["qty_sold"]) > 0 for e in ets.values())
    )

    return SalesEntryTodayResponse(
        entry_date=target_date,
        groups=groups,
        total_menu_types=len(menus),
        total_filled=total_filled,
    )


# ── POST /sales-entry ─────────────────────────────────────────────────────────

@router.post("/", response_model=SalesEntrySummary, status_code=status.HTTP_200_OK)
def submit_sales_entry(body: SalesEntrySubmit, user=Depends(require_admin)):
    """
    Submit qty terjual per menu untuk satu tanggal.
    Melakukan upsert ke daily_sales_entries, lalu recalculate theoretical_consumption.

    Boleh submit partial (tidak semua menu harus diisi).
    Boleh submit ulang untuk tanggal yang sama — data lama di-overwrite.
    """
    client = get_supabase_admin()
    date_str = body.entry_date.isoformat()

    # Validasi: pastikan semua menu_id valid dan ada di active_menus
    # (tidak strict — admin boleh entry menu yang sudah tidak aktif untuk koreksi historis)
    submitted_menu_ids = [e.menu_id for e in body.entries]
    existing_menus = (
        client.table("menu_items")
        .select("id")
        .in_("id", submitted_menu_ids)
        .execute()
        .data
    )
    valid_ids = {m["id"] for m in existing_menus}
    invalid = [mid for mid in submitted_menu_ids if mid not in valid_ids]
    if invalid:
        raise HTTPException(
            status_code=422,
            detail=f"menu_id tidak ditemukan: {invalid}",
        )

    # Upsert ke daily_sales_entries
    # Unique constraint: (entry_date, menu_id, entry_type)
    records = [
        {
            "entry_date":  date_str,
            "menu_id":     e.menu_id,
            "qty_sold":    e.qty_sold,
            "entry_type":  e.entry_type,
            "notes":       e.notes,
            "entered_by":  user["sub"],
        }
        for e in body.entries
    ]

    # Snapshot entries lama untuk rollback manual — guard stok di consumption.py
    # bisa menolak (InsufficientStockError) dan PostgREST tidak punya transaction.
    snapshot = (
        client.table("daily_sales_entries")
        .select("*")
        .eq("entry_date", date_str)
        .execute()
        .data
    ) or []

    client.table("daily_sales_entries").upsert(
        records,
        on_conflict="entry_date,menu_id,entry_type",
    ).execute()

    # Recalculate theoretical consumption (consumption.py mengambil SEMUA entry_type).
    # Guard stok negatif dicek DI DALAM sini sebelum consumption ditulis —
    # kalau ditolak, kembalikan entries ke kondisi sebelum submit lalu re-raise.
    try:
        ingredients_count = calculate_theoretical_consumption(body.entry_date, client)
    except InsufficientStockError:
        client.table("daily_sales_entries").delete().eq("entry_date", date_str).execute()
        if snapshot:
            client.table("daily_sales_entries").insert(snapshot).execute()
        raise

    # Hitung summary — revenue hanya dari entry_type='sale'
    all_entries = (
        client.table("daily_sales_entries")
        .select("menu_id, qty_sold, entry_type")
        .eq("entry_date", date_str)
        .gt("qty_sold", 0)
        .execute()
        .data
    )

    sale_entries = [e for e in all_entries if e.get("entry_type", "sale") == "sale"]
    comp_entries = [e for e in all_entries if e.get("entry_type") == "complimentary"]
    test_entries = [e for e in all_entries if e.get("entry_type") == "test"]

    if sale_entries:
        menu_ids_with_sales = list({e["menu_id"] for e in sale_entries})
        prices = (
            client.table("menu_items")
            .select("id, selling_price")
            .in_("id", menu_ids_with_sales)
            .execute()
            .data
        )
        price_map = {p["id"]: Decimal(str(p["selling_price"])) for p in prices}
        estimated_revenue = sum(
            Decimal(str(e["qty_sold"])) * price_map.get(e["menu_id"], Decimal("0"))
            for e in sale_entries
        )
    else:
        estimated_revenue = Decimal("0")

    total_porsi = sum(int(e["qty_sold"]) for e in sale_entries)
    unique_menus = len({e["menu_id"] for e in all_entries})

    return SalesEntrySummary(
        entry_date=body.entry_date,
        total_menu_types=unique_menus,
        total_porsi=total_porsi,
        estimated_revenue=estimated_revenue,
        complimentary_porsi=sum(int(e["qty_sold"]) for e in comp_entries),
        test_porsi=sum(int(e["qty_sold"]) for e in test_entries),
        ingredients_recalculated=ingredients_count,
    )


# ── GET /sales-entry/history ──────────────────────────────────────────────────

@router.get("/history")
def get_sales_history(
    date_from: date = Query(...),
    date_to: date = Query(...),
    user=Depends(get_current_user),
):
    """
    Ambil ringkasan sales per hari untuk periode tertentu.
    Berguna untuk dashboard dan laporan.
    """
    if date_from > date_to:
        raise HTTPException(status_code=422, detail="date_from harus <= date_to")
    if (date_to - date_from).days > 90:
        raise HTTPException(status_code=422, detail="Maksimal rentang 90 hari")

    client = get_supabase_admin()

    entries = (
        client.table("daily_sales_entries")
        .select("entry_date, menu_id, qty_sold, menu:menu_items!menu_id(name, selling_price, category)")
        .gte("entry_date", date_from.isoformat())
        .lte("entry_date", date_to.isoformat())
        .gt("qty_sold", 0)
        .order("entry_date", desc=True)
        .execute()
        .data
    )

    # Agregasi per hari
    by_date: dict[str, dict] = defaultdict(lambda: {
        "entry_date": None,
        "total_porsi": 0,
        "estimated_revenue": Decimal("0"),
        "menu_count": 0,
    })

    for e in entries:
        d = e["entry_date"]
        by_date[d]["entry_date"] = d
        by_date[d]["total_porsi"] += int(e["qty_sold"])
        by_date[d]["menu_count"] += 1
        menu = e.get("menu") or {}
        if menu.get("selling_price"):
            by_date[d]["estimated_revenue"] += Decimal(str(e["qty_sold"])) * Decimal(str(menu["selling_price"]))

    return sorted(by_date.values(), key=lambda x: x["entry_date"], reverse=True)
