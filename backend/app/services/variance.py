"""
Kalkulasi variance harian setelah opname di-submit.

Formula (per ingredient yang ada opname hari ini):
  theoretical_closing = opening_qty + production_in_qty - theoretical_out_qty - waste_qty
  variance_qty        = actual_closing_qty - theoretical_closing
  variance_pct        = variance_qty / theoretical_closing * 100
  is_flagged          = |variance_pct| > VARIANCE_THRESHOLD

opening_qty      = physical_qty dari opname hari sebelumnya (0 jika belum ada)
production_in    = net efek production_batches hari ini, dinormalisasi ke base unit:
                     output ingredient → +portions_actual × portion_size_g (base unit g/ml),
                                          as-is jika base unit porsi/pcs
                     raw ingredient    → -raw_qty_used (dikonversi raw_unit_id → base unit)
                   Negatif = raw terpakai untuk produksi.
theoretical_out  = dari tabel theoretical_consumption (dihitung setelah sales entry)
waste_qty        = SUM(qty) dari waste_logs hari ini untuk ingredient ini
actual_closing   = physical_qty dari opname hari ini

Hanya ingredient yang punya opname hari ini yang di-kalkulasi.
Simpan hasil ke variance_reports (UNIQUE: report_date + ingredient_id).
"""
from datetime import date, timedelta
from collections import defaultdict
from supabase import Client

from app.config import settings
from app.services.consumption import _build_conversion_cache
from app.services.stock_level import _convert


def calculate_variance(report_date: date, client: Client) -> list[dict]:
    """
    Recalculate variance untuk semua ingredient yang sudah di-opname pada report_date.

    Returns list of variance result dicts (sorted by |variance_pct| desc).
    """
    date_str  = report_date.isoformat()
    prev_str  = (report_date - timedelta(days=1)).isoformat()

    # ── 1. Opname hari ini (actual_closing) ───────────────────────────────────
    opname_today = (
        client.table("daily_stock_opname")
        .select("ingredient_id, physical_qty, unit_id")
        .eq("opname_date", date_str)
        .execute()
        .data
    )
    if not opname_today:
        return []

    ing_ids = [r["ingredient_id"] for r in opname_today]
    actual_map: dict[str, float] = {r["ingredient_id"]: float(r["physical_qty"]) for r in opname_today}
    unit_map:   dict[str, str]   = {r["ingredient_id"]: r["unit_id"]             for r in opname_today}

    # ── 2. Opening qty (opname kemarin) ──────────────────────────────────────
    opname_prev = (
        client.table("daily_stock_opname")
        .select("ingredient_id, physical_qty")
        .eq("opname_date", prev_str)
        .in_("ingredient_id", ing_ids)
        .execute()
        .data
    )
    opening_map: dict[str, float] = {r["ingredient_id"]: float(r["physical_qty"]) for r in opname_prev}

    # ── 3. Theoretical consumption (theoretical_out) ─────────────────────────
    consumption = (
        client.table("theoretical_consumption")
        .select("ingredient_id, consumed_qty")
        .eq("consumption_date", date_str)
        .in_("ingredient_id", ing_ids)
        .execute()
        .data
    )
    consumption_map: dict[str, float] = {r["ingredient_id"]: float(r["consumed_qty"]) for r in consumption}

    # ── 4. Production in/out (dari production_batches hari ini) ──────────────
    # Semua qty dinormalisasi ke base_unit ingredient — pola sama dengan
    # services/stock_level.py (batch 2 kg harus memotong 2000 g, bukan 2 g).
    # production_in negatif = raw terpakai untuk produksi hari ini.
    production_map: dict[str, float] = defaultdict(float)
    batch_rows = (
        client.table("production_batches")
        .select(
            "raw_qty_used, raw_unit_id, portions_actual,"
            " process:production_processes!process_id("
            "   raw_ingredient_id, output_ingredient_id, portion_size_g)"
        )
        .eq("batch_date", date_str)
        .execute()
        .data
    ) or []

    if batch_rows:
        ing_ids_set = set(ing_ids)
        batch_ing_ids = {
            iid
            for b in batch_rows
            for iid in [
                (b.get("process") or {}).get("raw_ingredient_id"),
                (b.get("process") or {}).get("output_ingredient_id"),
            ]
            if iid
        }
        base_unit_map: dict[str, str] = {
            r["id"]: r["base_unit_id"]
            for r in (
                client.table("ingredients")
                .select("id, base_unit_id")
                .in_("id", list(batch_ing_ids))
                .execute()
                .data
                or []
            )
        }
        unit_symbol = {
            u["id"]: u["symbol"]
            for u in (client.table("units").select("id, symbol").execute().data or [])
        }

        unit_pairs: set[tuple[str, str]] = set()
        for b in batch_rows:
            base = base_unit_map.get((b.get("process") or {}).get("raw_ingredient_id"))
            if base and b["raw_unit_id"] != base:
                unit_pairs.add((b["raw_unit_id"], base))
        conv_cache = _build_conversion_cache(client, unit_pairs)

        for b in batch_rows:
            proc    = b.get("process") or {}
            raw_iid = proc.get("raw_ingredient_id")
            out_iid = proc.get("output_ingredient_id")

            if raw_iid in ing_ids_set:
                raw_base = base_unit_map.get(raw_iid)
                qty = _convert(float(b["raw_qty_used"]), b["raw_unit_id"], raw_base, conv_cache)
                production_map[raw_iid] -= qty

            if out_iid in ing_ids_set:
                portions     = float(b["portions_actual"])
                out_sym      = unit_symbol.get(base_unit_map.get(out_iid))
                portion_size = float(proc.get("portion_size_g") or 0)
                qty = portions * portion_size if out_sym in ("g", "ml") and portion_size > 0 else portions
                production_map[out_iid] += qty

    # ── 4b. Waste qty (dari waste_logs hari ini) ─────────────────────────────
    waste_rows = (
        client.table("waste_logs")
        .select("ingredient_id, qty")
        .eq("waste_date", date_str)
        .in_("ingredient_id", ing_ids)
        .execute()
        .data
    )
    waste_map: dict[str, float] = defaultdict(float)
    for row in waste_rows:
        waste_map[row["ingredient_id"]] += float(row["qty"])

    # ── 5. Ingredient names (untuk return value) ─────────────────────────────
    ing_data = (
        client.table("ingredients")
        .select("id, name, division")
        .in_("id", ing_ids)
        .execute()
        .data
    )
    ing_name_map: dict[str, str] = {i["id"]: i["name"]     for i in ing_data}
    ing_div_map:  dict[str, str] = {i["id"]: i["division"] for i in ing_data}

    # ── 6. Kalkulasi & upsert ─────────────────────────────────────────────────
    records = []
    results = []

    for ing_id in ing_ids:
        opening_qty     = opening_map.get(ing_id, 0.0)
        production_in   = production_map.get(ing_id, 0.0)
        theoretical_out = consumption_map.get(ing_id, 0.0)
        waste_qty       = waste_map.get(ing_id, 0.0)
        actual_closing  = actual_map[ing_id]

        theoretical_closing = opening_qty + production_in - theoretical_out - waste_qty

        # Variance hanya bermakna jika ada theoretical_closing yang tidak nol
        # Jika theoretical_closing = 0 dan actual = 0 → tidak flag (normal, ingredient tidak aktif)
        if theoretical_closing == 0 and actual_closing == 0:
            variance_qty = 0.0
            variance_pct = 0.0
            is_flagged   = False
        elif theoretical_closing == 0:
            # Stok ada tapi tidak ada theoretical → 100% positif variance
            variance_qty = actual_closing
            variance_pct = 100.0
            is_flagged   = True
        else:
            variance_qty = actual_closing - theoretical_closing
            variance_pct = round(variance_qty / theoretical_closing * 100, 2)
            is_flagged   = abs(variance_pct) > settings.variance_threshold
            # Kolom variance_pct DECIMAL(5,2) — clamp ke ±999.99 supaya theoretical
            # yang sangat kecil (mis. opname perdana) tidak bikin numeric overflow
            variance_pct = max(-999.99, min(999.99, variance_pct))

        record = {
            "report_date":         date_str,
            "ingredient_id":       ing_id,
            "opening_qty":         round(opening_qty, 3),
            "production_in_qty":   round(production_in, 3),
            "theoretical_out_qty": round(theoretical_out, 3),
            "waste_qty":           round(waste_qty, 3),
            "theoretical_closing": round(theoretical_closing, 3),
            "actual_closing_qty":  round(actual_closing, 3),
            "variance_qty":        round(variance_qty, 3),
            "variance_pct":        variance_pct,
            "is_flagged":          is_flagged,
            "unit_id":             unit_map[ing_id],
        }
        records.append(record)
        results.append({
            **record,
            "ingredient_name": ing_name_map.get(ing_id, ""),
            "division":        ing_div_map.get(ing_id, ""),
        })

    if records:
        client.table("variance_reports").upsert(
            records,
            on_conflict="report_date,ingredient_id",
        ).execute()

    # Sort: paling buruk dulu (|variance_pct| desc, flagged first)
    results.sort(key=lambda x: (not x["is_flagged"], -abs(x["variance_pct"])))
    return results
