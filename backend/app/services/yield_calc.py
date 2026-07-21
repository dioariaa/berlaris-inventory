"""
Kalkulasi cumulative yield dan theoretical portions dari production stages.
"""
from supabase import Client


def get_cumulative_yield(process_id: str, client: Client) -> float:
    """
    Hitung cumulative yield dari semua stages, ordered by stage_order.
    cumulative_yield = PRODUCT(stage.yield_pct / 100)

    Contoh: trim 85% × masak 73% = 0.85 × 0.73 = 0.6205 (62.05%)
    """
    stages = (
        client.table("production_stages")
        .select("stage_order, stage_name, yield_pct")
        .eq("process_id", process_id)
        .order("stage_order")
        .execute()
        .data
    )

    if not stages:
        return 1.0

    cumulative = 1.0
    for stage in stages:
        cumulative *= float(stage["yield_pct"]) / 100.0

    return cumulative


def get_theoretical_portions(process_id: str, raw_qty_kg: float, client: Client) -> dict:
    """
    Hitung theoretical portions dari sejumlah raw_qty_kg.

    Formula:
        output_grams = raw_qty_kg * 1000 * cumulative_yield
        portions     = output_grams / portion_size_g

    Return dict dengan breakdown lengkap untuk audit.
    """
    process = (
        client.table("production_processes")
        .select("id, name, portion_size_g")
        .eq("id", process_id)
        .single()
        .execute()
        .data
    )

    stages = (
        client.table("production_stages")
        .select("stage_order, stage_name, yield_pct")
        .eq("process_id", process_id)
        .order("stage_order")
        .execute()
        .data
    )

    cumulative = 1.0
    running = raw_qty_kg * 1000  # mulai dalam gram
    stage_breakdown = []

    for stage in stages:
        pct = float(stage["yield_pct"]) / 100.0
        output_g = running * pct
        stage_breakdown.append({
            "stage_order": stage["stage_order"],
            "stage_name": stage["stage_name"],
            "yield_pct": float(stage["yield_pct"]),
            "input_g": round(running, 2),
            "output_g": round(output_g, 2),
        })
        running = output_g
        cumulative *= pct

    portion_size_g = float(process["portion_size_g"]) if process.get("portion_size_g") else None
    theoretical_portions = (running / portion_size_g) if portion_size_g else None

    return {
        "process_id": process_id,
        "process_name": process["name"],
        "raw_qty_kg": raw_qty_kg,
        "raw_qty_g": raw_qty_kg * 1000,
        "cumulative_yield_pct": round(cumulative * 100, 4),
        "output_g": round(running, 2),
        "portion_size_g": portion_size_g,
        "theoretical_portions": round(theoretical_portions, 2) if theoretical_portions else None,
        "stages": stage_breakdown,
    }
