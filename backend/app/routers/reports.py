"""
Reports router — generate Excel laporan audit.

POST /reports/generate
  Body: {date_from, date_to, division, report_type}
  Return: StreamingResponse (.xlsx)

Sheet 1 — Variance Report   (semua tanggal dalam rentang)
Sheet 2 — Food Cost Report  (period bulan dari date_from)
Sheet 3 — Ringkasan

Color coding via openpyxl PatternFill:
  FC > 40% → merah (#FFCCCC)
  FC 35–40% → kuning (#FFF2CC)
  FC < 35%  → hijau  (#CCFFCC)
"""
import io
import logging
from datetime import date
from typing import Optional, Literal

import pandas as pd
import openpyxl
from openpyxl.styles import PatternFill, Font, Alignment, Border, Side
from openpyxl.utils import get_column_letter

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, field_validator

from app.dependencies import require_owner, get_current_user
from app.services.supabase import get_supabase_admin

logger = logging.getLogger(__name__)
router = APIRouter()

# ── Color fills ───────────────────────────────────────────────────────────────
FILL_RED    = PatternFill("solid", fgColor="FFCCCC")
FILL_YELLOW = PatternFill("solid", fgColor="FFF2CC")
FILL_GREEN  = PatternFill("solid", fgColor="CCFFCC")
FILL_HEADER = PatternFill("solid", fgColor="1E3A5F")

FONT_HEADER  = Font(bold=True, color="FFFFFF", size=10)
FONT_BOLD    = Font(bold=True, size=10)
FONT_NORMAL  = Font(size=10)
ALIGN_CENTER = Alignment(horizontal="center", vertical="center")
ALIGN_LEFT   = Alignment(horizontal="left",   vertical="center")

THIN_BORDER = Border(
    left=Side(style="thin"), right=Side(style="thin"),
    top=Side(style="thin"),  bottom=Side(style="thin"),
)


def _safe_float(val, default: float = 0.0) -> float:
    try:
        return float(val) if val is not None else default
    except (TypeError, ValueError):
        return default


def _fc_fill(pct: float) -> Optional[PatternFill]:
    if pct > 40:  return FILL_RED
    if pct >= 35: return FILL_YELLOW
    return FILL_GREEN


def _fc_status(pct: float) -> str:
    if pct > 40:  return "High"
    if pct >= 35: return "OK"
    return "Good"


def _apply_header_row(ws, headers: list[str], row: int = 1):
    """Tulis baris header dengan styling biru gelap."""
    for col, h in enumerate(headers, start=1):
        cell = ws.cell(row=row, column=col, value=h)
        cell.fill   = FILL_HEADER
        cell.font   = FONT_HEADER
        cell.alignment = ALIGN_CENTER
        cell.border = THIN_BORDER


def _auto_col_width(ws):
    """Set lebar kolom otomatis berdasarkan konten (max 45)."""
    for col in ws.columns:
        max_len = 0
        col_letter = get_column_letter(col[0].column)
        for cell in col:
            try:
                val_len = len(str(cell.value)) if cell.value is not None else 0
                max_len = max(max_len, val_len)
            except Exception:
                pass
        ws.column_dimensions[col_letter].width = min(max_len + 4, 45)


def _border_data_rows(ws, start_row: int, end_row: int, col_count: int):
    for row in range(start_row, end_row + 1):
        for col in range(1, col_count + 1):
            ws.cell(row=row, column=col).border = THIN_BORDER


# ── Request model ─────────────────────────────────────────────────────────────

class ReportRequest(BaseModel):
    date_from:   date
    date_to:     date
    division:    str = "all"
    report_type: str = "full"

    @field_validator("division")
    @classmethod
    def valid_division(cls, v):
        if v not in ("kitchen", "bar", "all"):
            raise ValueError("division harus 'kitchen', 'bar', atau 'all'")
        return v

    @field_validator("report_type")
    @classmethod
    def valid_type(cls, v):
        if v not in ("variance", "food_cost", "full"):
            raise ValueError("report_type harus 'variance', 'food_cost', atau 'full'")
        return v

    @field_validator("date_to")
    @classmethod
    def date_range_valid(cls, v, info):
        if "date_from" in info.data and v < info.data["date_from"]:
            raise ValueError("date_to harus >= date_from")
        return v


# ── Rekap belanja per division & vendor ───────────────────────────────────────

@router.get("/purchases")
def purchase_report(
    start_date: date = Query(...),
    end_date:   date = Query(...),
    user=Depends(get_current_user),
):
    """
    Rekap belanja untuk halaman Purchase Report — pre-aggregated di backend:
    total periode, breakdown per division (po_category), breakdown per vendor
    (dengan rincian item untuk drill-down), dan tren pengeluaran harian.
    Initial stock di-exclude. Semua qty dalam base_unit.
    """
    if end_date < start_date:
        raise HTTPException(400, "end_date harus >= start_date")

    client = get_supabase_admin()

    receipts = (
        client.table("goods_receipts")
        .select("id, received_date, is_initial_stock")
        .gte("received_date", start_date.isoformat())
        .lte("received_date", end_date.isoformat())
        .execute()
        .data
    ) or []
    receipt_dates = {r["id"]: r["received_date"] for r in receipts if not r.get("is_initial_stock")}

    empty = {
        "start_date":        start_date.isoformat(),
        "end_date":          end_date.isoformat(),
        "total_amount":      0,
        "transaction_count": 0,
        "item_count":        0,
        "by_division":       [],
        "by_vendor":         [],
        "daily":             [],
    }
    if not receipt_dates:
        return empty

    items = (
        client.table("receipt_items")
        .select(
            "receipt_id, received_qty, actual_price_per_unit, po_category,"
            " ingredient:ingredients!ingredient_id(id, name),"
            " unit:units!unit_id(symbol, name),"
            " vendor:vendors!vendor_id(id, name)"
        )
        .in_("receipt_id", list(receipt_dates))
        .execute()
        .data
    ) or []
    if not items:
        return empty

    def _item_bucket(bucket: dict, ing: dict, unit: dict, date_key: str | None = None):
        # date_key terisi → baris dipecah per tanggal pembelian (dipakai vendor drill-down)
        key = f"{ing.get('id') or '?'}|{date_key or ''}"
        entry = bucket.setdefault(key, {
            "ingredient_name": ing.get("name") or "(tanpa nama)",
            "unit":            unit.get("symbol") or unit.get("name") or "",
            "total_qty":       0.0,
            "total":           0.0,
        })
        if date_key:
            entry["date"] = date_key
        return entry

    total_amount = 0.0
    by_division: dict[str, dict] = {}
    by_vendor:   dict[str, dict] = {}
    daily:       dict[str, float] = {}

    for it in items:
        qty    = float(it.get("received_qty") or 0)
        price  = float(it.get("actual_price_per_unit") or 0)
        amount = qty * price
        total_amount += amount

        ing    = it.get("ingredient") or {}
        unit   = it.get("unit") or {}
        vendor = it.get("vendor") or {}

        cat = it.get("po_category") or "lainnya"
        div = by_division.setdefault(cat, {"total": 0.0, "items": {}})
        div["total"] += amount
        d_item = _item_bucket(div["items"], ing, unit)
        d_item["total_qty"] += qty
        d_item["total"]     += amount

        vid = vendor.get("id") or "no_vendor"
        vnd = by_vendor.setdefault(vid, {
            "vendor_name": vendor.get("name") or "Tanpa Vendor",
            "receipt_ids": set(),
            "total":       0.0,
            "items":       {},
        })
        rdate = receipt_dates[it["receipt_id"]]

        vnd["receipt_ids"].add(it["receipt_id"])
        vnd["total"] += amount
        v_item = _item_bucket(vnd["items"], ing, unit, date_key=rdate)
        v_item["total_qty"] += qty
        v_item["total"]     += amount

        daily[rdate] = daily.get(rdate, 0.0) + amount

    def _pct(x: float) -> float:
        return round(x / total_amount * 100, 1) if total_amount > 0 else 0.0

    def _finish_items(bucket: dict, by_date: bool = False) -> list[dict]:
        out = []
        for entry in bucket.values():
            entry["avg_price"] = round(entry["total"] / entry["total_qty"], 2) if entry["total_qty"] > 0 else 0
            entry["total"]     = round(entry["total"], 2)
            entry["total_qty"] = round(entry["total_qty"], 3)
            out.append(entry)
        if by_date:
            # vendor drill-down: terbaru dulu, lalu termahal
            return sorted(out, key=lambda e: (e.get("date") or "", e["total"]), reverse=True)
        return sorted(out, key=lambda e: e["total"], reverse=True)

    return {
        "start_date":        start_date.isoformat(),
        "end_date":          end_date.isoformat(),
        "total_amount":      round(total_amount, 2),
        "transaction_count": len({it["receipt_id"] for it in items}),
        "item_count":        len(items),
        "by_division": sorted(
            [
                {
                    "division": cat,
                    "total":    round(d["total"], 2),
                    "pct":      _pct(d["total"]),
                    "items":    _finish_items(d["items"]),
                }
                for cat, d in by_division.items()
            ],
            key=lambda e: e["total"], reverse=True,
        ),
        "by_vendor": sorted(
            [
                {
                    "vendor_id":         vid,
                    "vendor_name":       v["vendor_name"],
                    "transaction_count": len(v["receipt_ids"]),
                    "total":             round(v["total"], 2),
                    "pct":               _pct(v["total"]),
                    "items":             _finish_items(v["items"], by_date=True),
                }
                for vid, v in by_vendor.items()
            ],
            key=lambda e: e["total"], reverse=True,
        ),
        "daily": [
            {"date": d, "total": round(t, 2)}
            for d, t in sorted(daily.items())
        ],
    }


# ── Endpoint ──────────────────────────────────────────────────────────────────

@router.post("/generate")
def generate_report(body: ReportRequest, user=Depends(require_owner)):
    """
    Generate laporan Excel multi-sheet.
    Return StreamingResponse .xlsx dengan nama file berisi rentang tanggal.
    """
    client      = get_supabase_admin()
    date_from   = body.date_from.isoformat()
    date_to     = body.date_to.isoformat()
    period_month = date(body.date_from.year, body.date_from.month, 1).isoformat()

    # ── 1. Fetch data variance ─────────────────────────────────────────────────
    var_q = (
        client.table("variance_reports")
        .select(
            "report_date, is_flagged,"
            "opening_qty, production_in_qty, theoretical_out_qty,"
            "theoretical_closing, actual_closing_qty,"
            "variance_qty, variance_pct,"
            "ingredient:ingredients!ingredient_id(name, division)"
        )
        .gte("report_date", date_from)
        .lte("report_date", date_to)
        .order("report_date", desc=True)
        .order("variance_pct", desc=False)   # terburuk (paling negatif) dulu
        .limit(5000)
        .execute()
        .data
    ) or []

    # Filter division di Python (nested join field)
    if body.division != "all":
        var_q = [
            r for r in var_q
            if (r.get("ingredient") or {}).get("division") == body.division
        ]

    # Filter: hanya flagged untuk report_type='variance'
    var_rows = var_q
    if body.report_type == "variance":
        var_rows = [r for r in var_q if r.get("is_flagged")]

    # ── 2. Fetch data HPP ──────────────────────────────────────────────────────
    hpp_q = (
        client.table("menu_hpp")
        .select(
            "food_cost_pct, hpp_amount,"
            "menu:menu_items!menu_id(name, category, division, selling_price)"
        )
        .eq("period_month", period_month)
        .order("food_cost_pct", desc=True)
        .limit(500)
        .execute()
        .data
    ) or []

    if body.division != "all":
        hpp_q = [
            r for r in hpp_q
            if (r.get("menu") or {}).get("division") == body.division
        ]

    # ── Validation: ada data? ──────────────────────────────────────────────────
    needs_variance  = body.report_type in ("variance", "full")
    needs_food_cost = body.report_type in ("food_cost", "full")

    # Untuk "variance" atau "food_cost" murni: wajib ada data tipe itu.
    # Untuk "full": cukup salah satu ada data (skip sheet yang kosong dengan pesan).
    if body.report_type == "variance" and not var_rows:
        raise HTTPException(
            400,
            f"Tidak ada data variance untuk periode {date_from} s/d {date_to}"
            + (f" (divisi: {body.division})" if body.division != "all" else "")
            + " — hanya flagged",
        )
    if body.report_type == "food_cost" and not hpp_q:
        raise HTTPException(
            400,
            f"Tidak ada data HPP untuk periode bulan {period_month[:7]}"
            + (f" (divisi: {body.division})" if body.division != "all" else ""),
        )
    if body.report_type == "full" and not var_rows and not hpp_q:
        raise HTTPException(
            400,
            f"Tidak ada data sama sekali untuk periode {date_from} s/d {date_to}"
            + (f" (divisi: {body.division})" if body.division != "all" else ""),
        )

    # ── 3. Build workbook ──────────────────────────────────────────────────────
    wb = openpyxl.Workbook()
    wb.remove(wb.active)   # hapus sheet default kosong

    # ─── Sheet 1: Variance ────────────────────────────────────────────────────
    if needs_variance:
        ws_var = wb.create_sheet("Variance Report")
        var_headers = [
            "Tanggal", "Divisi", "Nama Bahan",
            "Opening", "Prod In", "Theo Out", "Theo Closing",
            "Aktual", "Variance Qty", "Variance %", "Status",
        ]
        _apply_header_row(ws_var, var_headers)

        if not var_rows:
            # Sheet tetap ada, tapi dengan pesan informatif
            cell = ws_var.cell(row=2, column=1,
                               value=f"Belum ada data variance untuk periode {date_from} s/d {date_to}.")
            cell.font = Font(italic=True, color="888888", size=10)
        else:
            for i, r in enumerate(var_rows, start=2):
                ing      = r.get("ingredient") or {}
                var_pct  = _safe_float(r.get("variance_pct"))
                flagged  = r.get("is_flagged", False)

                values = [
                    r.get("report_date", ""),
                    ing.get("division", ""),
                    ing.get("name", "?"),
                    _safe_float(r.get("opening_qty")),
                    _safe_float(r.get("production_in_qty")),
                    _safe_float(r.get("theoretical_out_qty")),
                    _safe_float(r.get("theoretical_closing")),
                    _safe_float(r.get("actual_closing_qty")),
                    _safe_float(r.get("variance_qty")),
                    round(var_pct, 2),
                    "⚠ Flagged" if flagged else "Normal",
                ]
                for col, val in enumerate(values, start=1):
                    cell = ws_var.cell(row=i, column=col, value=val)
                    cell.font   = FONT_NORMAL
                    cell.alignment = ALIGN_LEFT
                    if flagged:
                        cell.fill = FILL_RED
                    elif var_pct < 0:
                        cell.fill = FILL_YELLOW

            _border_data_rows(ws_var, 2, len(var_rows) + 1, len(var_headers))
        _auto_col_width(ws_var)
        ws_var.freeze_panes = "A2"

    # ─── Sheet 2: Food Cost ───────────────────────────────────────────────────
    if needs_food_cost:
        ws_fc = wb.create_sheet("Food Cost Report")
        fc_headers = [
            "Nama Menu", "Kategori", "Divisi",
            "Harga Jual", "HPP", "FC%", "Status",
        ]
        _apply_header_row(ws_fc, fc_headers)

        if not hpp_q:
            cell = ws_fc.cell(row=2, column=1,
                               value=f"Belum ada data HPP untuk periode bulan {period_month[:7]}.")
            cell.font = Font(italic=True, color="888888", size=10)
        else:
            for i, r in enumerate(hpp_q, start=2):
                menu = r.get("menu") or {}
                fc   = _safe_float(r.get("food_cost_pct"))
                hpp  = _safe_float(r.get("hpp_amount"))
                sp   = _safe_float(menu.get("selling_price"))

                values = [
                    menu.get("name", "?"),
                    menu.get("category", "other"),
                    menu.get("division", ""),
                    sp,
                    round(hpp, 0),
                    round(fc, 1),
                    _fc_status(fc),
                ]
                fill = _fc_fill(fc)
                for col, val in enumerate(values, start=1):
                    cell = ws_fc.cell(row=i, column=col, value=val)
                    cell.font      = FONT_NORMAL
                    cell.alignment = ALIGN_LEFT
                    if fill:
                        cell.fill = fill

            _border_data_rows(ws_fc, 2, len(hpp_q) + 1, len(fc_headers))
        _auto_col_width(ws_fc)
        ws_fc.freeze_panes = "A2"

    # ─── Sheet 3: Ringkasan ───────────────────────────────────────────────────
    ws_sum = wb.create_sheet("Ringkasan")

    def _write_kv(ws, row, key, value, val_fill=None):
        k = ws.cell(row=row, column=1, value=key)
        v = ws.cell(row=row, column=2, value=value)
        k.font      = FONT_BOLD
        v.font      = FONT_NORMAL
        k.alignment = ALIGN_LEFT
        v.alignment = ALIGN_LEFT
        k.border    = THIN_BORDER
        v.border    = THIN_BORDER
        if val_fill:
            v.fill = val_fill

    # Header ringkasan
    title_cell = ws_sum.cell(row=1, column=1, value="LAPORAN BERLARIS KOPI & RESTO")
    title_cell.font   = Font(bold=True, size=14, color="1E3A5F")
    title_cell.alignment = ALIGN_LEFT
    ws_sum.merge_cells("A1:B1")

    _write_kv(ws_sum, 3,  "Periode Laporan",
               f"{body.date_from.strftime('%d %b %Y')} s/d {body.date_to.strftime('%d %b %Y')}")
    _write_kv(ws_sum, 4,  "Divisi",         body.division.upper())
    _write_kv(ws_sum, 5,  "Jenis Laporan",  body.report_type.replace("_", " ").title())
    _write_kv(ws_sum, 6,  "Dibuat tanggal", date.today().strftime("%d %b %Y"))

    ws_sum.cell(row=8, column=1, value="RINGKASAN VARIANCE").font = FONT_BOLD
    total_var   = len(var_q)
    flagged_var = sum(1 for r in var_q if r.get("is_flagged"))
    _write_kv(ws_sum, 9,  "Total baris variance", total_var)
    _write_kv(ws_sum, 10, "Flagged (>5%)",         flagged_var,
               FILL_RED if flagged_var > 0 else FILL_GREEN)

    if var_q:
        pcts = [_safe_float(r.get("variance_pct")) for r in var_q]
        _write_kv(ws_sum, 11, "Rata-rata variance %",  round(sum(pcts) / len(pcts), 2))

    ws_sum.cell(row=13, column=1, value="RINGKASAN FOOD COST").font = FONT_BOLD
    if hpp_q:
        fc_pcts = [_safe_float(r.get("food_cost_pct")) for r in hpp_q if r.get("food_cost_pct") is not None]
        avg_fc  = round(sum(fc_pcts) / len(fc_pcts), 1) if fc_pcts else 0
        above40 = sum(1 for p in fc_pcts if p > 40)
        _write_kv(ws_sum, 14, "Total menu dengan HPP",  len(hpp_q))
        _write_kv(ws_sum, 15, "Rata-rata Food Cost %",  f"{avg_fc}%",
                   _fc_fill(avg_fc))
        _write_kv(ws_sum, 16, "Menu FC > 40%",          above40,
                   FILL_RED if above40 > 0 else FILL_GREEN)
    else:
        _write_kv(ws_sum, 14, "HPP", "Tidak ada data periode ini")

    ws_sum.column_dimensions["A"].width = 28
    ws_sum.column_dimensions["B"].width = 32

    # ── 4. Stream ke client ────────────────────────────────────────────────────
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)

    filename = f"berlaris_report_{body.date_from}_{body.date_to}.xlsx"
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
