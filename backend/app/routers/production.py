from fastapi import APIRouter, Depends, HTTPException, Query, status
from typing import Optional
from datetime import date
from decimal import Decimal
import logging

from app.models.production import (
    ProcessCreate, ProcessUpdate, ProcessResponse,
    StageCreate, StageUpdate, StageResponse,
    OutputCreate, OutputUpdate, OutputResponse,
    YieldResult, BatchCreate, BatchResponse,
)
from app.dependencies import require_admin, get_current_user
from app.services.supabase import get_supabase_admin
from app.services.yield_calc import get_cumulative_yield, get_theoretical_portions
from app.config import settings

logger = logging.getLogger(__name__)

router = APIRouter()

SELECT_PROCESS = "*, raw:ingredients!raw_ingredient_id(name), output:ingredients!output_ingredient_id(name)"
SELECT_STAGE = "id, process_id, stage_order, stage_name, yield_pct, notes, created_at"
SELECT_OUTPUT = "id, process_id, output_ingredient_id, output_qty_per_batch, unit_id, cost_allocation_pct, notes, created_at, ingredient:ingredients!output_ingredient_id(name), unit:units!unit_id(name)"
SELECT_INPUT = (
    "id, process_id, ingredient_id, qty_per_batch, unit_id, notes, created_at,"
    " ingredient:ingredients!ingredient_id(name), unit:units!unit_id(symbol)"
)


def _flatten_process(r: dict, stages: list, outputs: list, inputs: list) -> dict:
    raw = r.pop("raw", None) or {}
    out = r.pop("output", None) or {}
    r["raw_ingredient_name"] = raw.get("name")
    r["output_ingredient_name"] = out.get("name")
    r["stages"] = stages
    r["outputs"] = outputs
    r["inputs"] = inputs
    return r


def _flatten_output(r: dict) -> dict:
    ing = r.pop("ingredient", None) or {}
    unit = r.pop("unit", None) or {}
    r["output_ingredient_name"] = ing.get("name")
    r["unit_name"] = unit.get("name")
    return r


def _flatten_input(r: dict) -> dict:
    ing = r.pop("ingredient", None) or {}
    unit = r.pop("unit", None) or {}
    r["ingredient_name"] = ing.get("name")
    r["unit_symbol"] = unit.get("symbol")
    return r


def _load_nested(client, process_id: str) -> tuple[list, list, list]:
    stages = (
        client.table("production_stages")
        .select(SELECT_STAGE)
        .eq("process_id", process_id)
        .order("stage_order")
        .execute()
        .data
    )
    raw_outputs = (
        client.table("production_outputs")
        .select(SELECT_OUTPUT)
        .eq("process_id", process_id)
        .execute()
        .data
    )
    outputs = [_flatten_output(r) for r in raw_outputs]
    try:
        raw_inputs = (
            client.table("production_inputs")
            .select(SELECT_INPUT)
            .eq("process_id", process_id)
            .execute()
            .data
        ) or []
    except Exception:
        raw_inputs = []  # tabel belum ada (migration belum dijalankan)
    inputs = [_flatten_input(r) for r in raw_inputs]
    return stages, outputs, inputs


# ─────────────────────────────────────────────
# PRODUCTION PROCESSES
# ─────────────────────────────────────────────

@router.get("/processes", response_model=list[ProcessResponse])
def list_processes(
    active: bool = Query(True),
    search: Optional[str] = Query(None),
    user=Depends(get_current_user),
):
    client = get_supabase_admin()
    q = client.table("production_processes").select(SELECT_PROCESS).eq("is_active", active)
    if search:
        q = q.ilike("name", f"%{search}%")
    rows = q.order("name").execute().data

    result = []
    for r in rows:
        stages, outputs, inputs = _load_nested(client, r["id"])
        result.append(_flatten_process(r, stages, outputs, inputs))
    return result


@router.get("/processes/{process_id}", response_model=ProcessResponse)
def get_process(process_id: str, user=Depends(get_current_user)):
    client = get_supabase_admin()
    r = (
        client.table("production_processes")
        .select(SELECT_PROCESS)
        .eq("id", process_id)
        .maybe_single()
        .execute()
    )
    if not r.data:
        raise HTTPException(status_code=404, detail="Production process tidak ditemukan")
    stages, outputs, inputs = _load_nested(client, process_id)
    return _flatten_process(r.data, stages, outputs, inputs)


@router.post("/processes", response_model=ProcessResponse, status_code=status.HTTP_201_CREATED)
def create_process(body: ProcessCreate, user=Depends(require_admin)):
    client = get_supabase_admin()

    # Multi-input (bumbu/sambal) ATAU legacy single-raw — minimal salah satu
    if not body.raw_ingredient_id and not body.inputs:
        raise HTTPException(
            status_code=422,
            detail="Proses harus punya bahan: isi raw_ingredient_id (bahan tunggal) "
                   "ATAU daftar 'inputs' (multi-bahan, mis. bumbu).",
        )

    # Validasi ingredient IDs (output wajib; raw & inputs sesuai yang diisi)
    check_ids = [("output_ingredient_id", body.output_ingredient_id)]
    if body.raw_ingredient_id:
        check_ids.append(("raw_ingredient_id", body.raw_ingredient_id))
    check_ids += [
        (f"inputs[{i}].ingredient_id", inp.ingredient_id)
        for i, inp in enumerate(body.inputs)
    ]
    for field, val in check_ids:
        r = client.table("ingredients").select("id").eq("id", val).maybe_single().execute()
        if not r.data:
            raise HTTPException(status_code=422, detail=f"{field} '{val}' tidak ditemukan")

    process_data = body.model_dump(exclude={"stages", "outputs", "inputs"}, mode="json")
    result = client.table("production_processes").insert(process_data).execute()
    process_id = result.data[0]["id"]

    if body.inputs:
        client.table("production_inputs").insert([
            {**i.model_dump(mode="json"), "process_id": process_id}
            for i in body.inputs
        ]).execute()

    if body.stages:
        stage_records = [
            {**s.model_dump(mode="json"), "process_id": process_id}
            for s in sorted(body.stages, key=lambda x: x.stage_order)
        ]
        client.table("production_stages").insert(stage_records).execute()

    if body.outputs:
        # Validasi total cost_allocation = 100 jika lebih dari 1 output
        if len(body.outputs) > 1:
            total_alloc = sum(float(o.cost_allocation_pct) for o in body.outputs)
            if abs(total_alloc - 100.0) > 0.01:
                raise HTTPException(status_code=422, detail=f"Total cost_allocation_pct harus = 100, saat ini {total_alloc}")
        output_records = [
            {**o.model_dump(mode="json"), "process_id": process_id}
            for o in body.outputs
        ]
        client.table("production_outputs").insert(output_records).execute()

    r = client.table("production_processes").select(SELECT_PROCESS).eq("id", process_id).single().execute()
    stages, outputs, inputs = _load_nested(client, process_id)
    return _flatten_process(r.data, stages, outputs, inputs)


@router.put("/processes/{process_id}", response_model=ProcessResponse)
def update_process(process_id: str, body: ProcessUpdate, user=Depends(require_admin)):
    client = get_supabase_admin()
    existing = client.table("production_processes").select("id").eq("id", process_id).maybe_single().execute()
    if not existing.data:
        raise HTTPException(status_code=404, detail="Production process tidak ditemukan")

    data = body.model_dump(exclude_none=True, mode="json")
    if not data:
        raise HTTPException(status_code=422, detail="Tidak ada field yang diupdate")

    client.table("production_processes").update(data).eq("id", process_id).execute()

    r = client.table("production_processes").select(SELECT_PROCESS).eq("id", process_id).single().execute()
    stages, outputs, inputs = _load_nested(client, process_id)
    return _flatten_process(r.data, stages, outputs, inputs)


@router.delete("/processes/{process_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_process(process_id: str, user=Depends(require_admin)):
    client = get_supabase_admin()
    existing = client.table("production_processes").select("id").eq("id", process_id).maybe_single().execute()
    if not existing.data:
        raise HTTPException(status_code=404, detail="Production process tidak ditemukan")
    # Soft delete — stages/outputs tetap tersimpan untuk audit
    client.table("production_processes").update({"is_active": False}).eq("id", process_id).execute()


# ─────────────────────────────────────────────
# YIELD CALCULATION
# ─────────────────────────────────────────────

@router.get("/processes/{process_id}/yield")
def calculate_yield(
    process_id: str,
    raw_qty_kg: float = Query(1.0, gt=0, description="Qty raw input dalam kg"),
    user=Depends(get_current_user),
):
    """
    Hitung cumulative yield dan theoretical portions untuk qty raw tertentu.
    Default: 1 kg raw.
    """
    client = get_supabase_admin()
    proc = client.table("production_processes").select("id").eq("id", process_id).maybe_single().execute()
    if not proc.data:
        raise HTTPException(status_code=404, detail="Production process tidak ditemukan")

    return get_theoretical_portions(process_id, raw_qty_kg, client)


# ─────────────────────────────────────────────
# STAGES (nested CRUD)
# ─────────────────────────────────────────────

@router.post("/processes/{process_id}/stages", response_model=StageResponse, status_code=status.HTTP_201_CREATED)
def add_stage(process_id: str, body: StageCreate, user=Depends(require_admin)):
    client = get_supabase_admin()
    proc = client.table("production_processes").select("id").eq("id", process_id).maybe_single().execute()
    if not proc.data:
        raise HTTPException(status_code=404, detail="Production process tidak ditemukan")

    try:
        result = client.table("production_stages").insert({
            **body.model_dump(mode="json"), "process_id": process_id
        }).execute()
        return result.data[0]
    except Exception as e:
        if "unique" in str(e).lower():
            raise HTTPException(status_code=409, detail=f"stage_order {body.stage_order} sudah ada di proses ini")
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/processes/{process_id}/stages/{stage_id}", response_model=StageResponse)
def update_stage(process_id: str, stage_id: str, body: StageUpdate, user=Depends(require_admin)):
    client = get_supabase_admin()
    existing = client.table("production_stages").select("id").eq("id", stage_id).eq("process_id", process_id).maybe_single().execute()
    if not existing.data:
        raise HTTPException(status_code=404, detail="Stage tidak ditemukan")

    data = body.model_dump(exclude_none=True, mode="json")
    if not data:
        raise HTTPException(status_code=422, detail="Tidak ada field yang diupdate")

    result = client.table("production_stages").update(data).eq("id", stage_id).execute()
    return result.data[0]


@router.delete("/processes/{process_id}/stages/{stage_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_stage(process_id: str, stage_id: str, user=Depends(require_admin)):
    client = get_supabase_admin()
    existing = client.table("production_stages").select("id").eq("id", stage_id).eq("process_id", process_id).maybe_single().execute()
    if not existing.data:
        raise HTTPException(status_code=404, detail="Stage tidak ditemukan")
    client.table("production_stages").delete().eq("id", stage_id).execute()


# ─────────────────────────────────────────────
# OUTPUTS (nested CRUD)
# ─────────────────────────────────────────────

@router.post("/processes/{process_id}/outputs", response_model=OutputResponse, status_code=status.HTTP_201_CREATED)
def add_output(process_id: str, body: OutputCreate, user=Depends(require_admin)):
    client = get_supabase_admin()
    proc = client.table("production_processes").select("id").eq("id", process_id).maybe_single().execute()
    if not proc.data:
        raise HTTPException(status_code=404, detail="Production process tidak ditemukan")

    result = client.table("production_outputs").insert({
        **body.model_dump(mode="json"), "process_id": process_id
    }).execute()

    row = (
        client.table("production_outputs")
        .select(SELECT_OUTPUT)
        .eq("id", result.data[0]["id"])
        .single()
        .execute()
        .data
    )
    return _flatten_output(row)


@router.put("/processes/{process_id}/outputs/{output_id}", response_model=OutputResponse)
def update_output(process_id: str, output_id: str, body: OutputUpdate, user=Depends(require_admin)):
    client = get_supabase_admin()
    existing = client.table("production_outputs").select("id").eq("id", output_id).eq("process_id", process_id).maybe_single().execute()
    if not existing.data:
        raise HTTPException(status_code=404, detail="Output tidak ditemukan")

    data = body.model_dump(exclude_none=True, mode="json")
    if not data:
        raise HTTPException(status_code=422, detail="Tidak ada field yang diupdate")

    client.table("production_outputs").update(data).eq("id", output_id).execute()
    row = client.table("production_outputs").select(SELECT_OUTPUT).eq("id", output_id).single().execute().data
    return _flatten_output(row)


@router.delete("/processes/{process_id}/outputs/{output_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_output(process_id: str, output_id: str, user=Depends(require_admin)):
    client = get_supabase_admin()
    existing = client.table("production_outputs").select("id").eq("id", output_id).eq("process_id", process_id).maybe_single().execute()
    if not existing.data:
        raise HTTPException(status_code=404, detail="Output tidak ditemukan")
    client.table("production_outputs").delete().eq("id", output_id).execute()


# ─────────────────────────────────────────────
# PRODUCTION BATCHES
# ─────────────────────────────────────────────

SELECT_BATCH = (
    "id, process_id, batch_date, raw_qty_used, raw_unit_id,"
    " portions_actual, portions_theoretical, yield_actual_pct, variance_pct,"
    " is_flagged, processed_by, notes, created_at,"
    " process:production_processes!process_id("
    "   name,"
    "   raw:ingredients!raw_ingredient_id(name),"
    "   output:ingredients!output_ingredient_id(name)"
    " ),"
    " raw_unit:units!raw_unit_id(name, symbol)"
)


def _flatten_batch(r: dict) -> dict:
    proc = r.pop("process", None) or {}
    raw_unit = r.pop("raw_unit", None) or {}
    r["process_name"]           = proc.get("name")
    r["raw_ingredient_name"]    = (proc.get("raw") or {}).get("name")
    r["output_ingredient_name"] = (proc.get("output") or {}).get("name")
    r["raw_unit_name"]          = raw_unit.get("name")
    return r


def _convert_raw_to_kg(raw_qty: float, raw_unit_id: str, client) -> float:
    """
    Konversi raw_qty dari raw_unit_id ke kilogram.

    Diperlukan karena get_theoretical_portions mengharapkan input dalam kg
    (yield stages dihitung dalam gram: raw_qty_kg × 1000 → gram).

    Lookup unit_conversions: direct (raw→kg) lalu reverse (kg→raw, di-inverse).
    Jika tidak ditemukan, asumsikan sudah dalam kg dan log warning.
    """
    # Cari unit dengan symbol 'kg'
    kg_row = (
        client.table("units")
        .select("id")
        .eq("symbol", "kg")
        .maybe_single()
        .execute()
        .data
    )
    if not kg_row:
        logger.warning("unit 'kg' tidak ditemukan di DB, raw_qty dianggap sudah dalam kg")
        return raw_qty

    kg_unit_id = kg_row["id"]

    if raw_unit_id == kg_unit_id:
        return raw_qty  # sudah dalam kg

    # Coba konversi langsung: raw_unit → kg
    direct = (
        client.table("unit_conversions")
        .select("factor")
        .eq("from_unit_id", raw_unit_id)
        .eq("to_unit_id", kg_unit_id)
        .maybe_single()
        .execute()
        .data
    )
    if direct:
        return raw_qty * float(direct["factor"])

    # Coba konversi balik: kg → raw_unit, lalu inverse
    reverse = (
        client.table("unit_conversions")
        .select("factor")
        .eq("from_unit_id", kg_unit_id)
        .eq("to_unit_id", raw_unit_id)
        .maybe_single()
        .execute()
        .data
    )
    if reverse:
        return raw_qty / float(reverse["factor"])

    logger.warning(
        "Tidak ada konversi ke kg untuk unit_id %s — raw_qty dianggap sudah dalam kg",
        raw_unit_id,
    )
    return raw_qty


def _load_batch_inputs(client, batch_id: str) -> list[dict]:
    """Input aktual satu batch untuk response — [] jika tabel belum ada."""
    try:
        rows = (
            client.table("batch_inputs")
            .select(
                "ingredient_id, qty_used, unit_id,"
                " ingredient:ingredients!ingredient_id(name), unit:units!unit_id(symbol)"
            )
            .eq("batch_id", batch_id)
            .execute()
            .data
        ) or []
    except Exception:
        return []
    out = []
    for r in rows:
        ing  = r.pop("ingredient", None) or {}
        unit = r.pop("unit", None) or {}
        r["ingredient_name"] = ing.get("name")
        r["unit_symbol"]     = unit.get("symbol")
        out.append(r)
    return out


def _multi_input_theoretical(process_id, actual_inputs, std_rows, ing_map, cache, client):
    """
    Theoretical output batch multi-input:
      scale       = Σ(qty aktual dlm base unit) ÷ Σ(qty standar dlm base unit)
                    — hanya bahan yang match production_inputs; bahan ekstra
                    tetap dipotong stok tapi tidak masuk skala
      theoretical = scale × production_outputs.output_qty_per_batch

    CATATAN: stages TIDAK dikalikan lagi — output_qty_per_batch sudah angka
    ekspektasi hasil akhir (menghindari diskon yield ganda).
    Return None jika standar/output belum dikonfigurasi (perilaku sama dengan
    portion_size_g belum diset di jalur single-raw).
    """
    std_by_ing = {s["ingredient_id"]: s for s in std_rows}

    tot_std = tot_act = 0.0
    for inp in actual_inputs:
        s = std_by_ing.get(inp.ingredient_id)
        if not s:
            continue
        base = (ing_map.get(inp.ingredient_id) or {}).get("base_unit_id")
        f_act = cache.get((inp.unit_id, base), 1.0) if inp.unit_id != base else 1.0
        f_std = cache.get((s["unit_id"], base), 1.0) if s["unit_id"] != base else 1.0
        tot_act += float(inp.qty_used) * f_act
        tot_std += float(s["qty_per_batch"]) * f_std
    if tot_std <= 0:
        return None

    out_rows = (
        client.table("production_outputs")
        .select("output_qty_per_batch")
        .eq("process_id", process_id)
        .limit(1)
        .execute()
        .data
    ) or []
    expected = float((out_rows[0].get("output_qty_per_batch") if out_rows else 0) or 0)
    if expected <= 0:
        logger.warning(
            "Batch multi-input process %s: output_qty_per_batch belum diset, "
            "theoretical tidak dikalkulasi", process_id,
        )
        return None
    return round((tot_act / tot_std) * expected, 2)


@router.post("/batches", response_model=BatchResponse, status_code=status.HTTP_201_CREATED)
def create_batch(body: BatchCreate, user=Depends(require_admin)):
    """
    Log batch produksi dan hitung yield vs theoretical secara otomatis.

    Dua mode — tepat SATU yang diisi:
      - Single-raw (legacy): raw_qty_used + raw_unit_id
      - Multi-input (bumbu): daftar `inputs` — komponen aktual dipotong dari
        stok, theoretical = (Σ aktual ÷ Σ standar production_inputs) ×
        output_qty_per_batch

    yield_actual_pct = portions_actual / portions_theoretical × 100
    variance_pct     = (actual − theoretical) / theoretical × 100
    is_flagged       = |variance_pct| > VARIANCE_THRESHOLD (default 5%)
    """
    client = get_supabase_admin()

    # XOR: tepat satu mode. Divalidasi di sini (bukan Pydantic) supaya pesan
    # ke frontend berupa string Indonesia, bukan array 422 default.
    has_legacy = body.raw_qty_used is not None and body.raw_unit_id is not None
    has_inputs = bool(body.inputs)
    if has_legacy == has_inputs:
        raise HTTPException(
            status_code=422,
            detail="Isi salah satu: bahan tunggal (raw_qty_used + raw_unit_id) "
                   "ATAU daftar 'inputs' untuk proses multi-bahan — tidak boleh keduanya.",
        )

    # Validasi process exists dan aktif
    proc_row = (
        client.table("production_processes")
        .select("id, name, portion_size_g, is_active, raw_ingredient_id, output_ingredient_id")
        .eq("id", body.process_id)
        .maybe_single()
        .execute()
        .data
    )
    if not proc_row:
        raise HTTPException(status_code=404, detail="Production process tidak ditemukan")
    if not proc_row.get("is_active", True):
        raise HTTPException(status_code=422, detail="Production process sudah nonaktif")

    from app.services.stock_guard import assert_sufficient_stock, assert_sufficient_stock_many
    from app.services.stock_level import _division_location
    from app.services.consumption import _build_conversion_cache

    if has_inputs:
        # ── Jalur MULTI-INPUT (bumbu/sambal) ─────────────────────────────────
        try:
            std_rows = (
                client.table("production_inputs")
                .select("ingredient_id, qty_per_batch, unit_id")
                .eq("process_id", body.process_id)
                .execute()
                .data
            ) or []
        except Exception:
            raise HTTPException(
                status_code=500,
                detail="Tabel production_inputs belum ada — jalankan migration "
                       "berlaris_migration_production_inputs.sql dulu.",
            )

        actual_ids = [i.ingredient_id for i in body.inputs]
        all_ids = list({
            *actual_ids,
            *(s["ingredient_id"] for s in std_rows),
            proc_row["output_ingredient_id"],
        })
        ing_rows = (
            client.table("ingredients")
            .select("id, base_unit_id, division")
            .in_("id", all_ids)
            .execute()
            .data
        ) or []
        ing_map = {r["id"]: r for r in ing_rows}
        missing = [i for i in actual_ids if i not in ing_map]
        if missing:
            raise HTTPException(
                status_code=422,
                detail=f"Ingredient tidak ditemukan: {', '.join(missing)}",
            )

        prod_loc = _division_location(
            (ing_map.get(proc_row["output_ingredient_id"]) or {}).get("division")
        )

        pairs: set[tuple[str, str]] = set()
        for i in body.inputs:
            base = ing_map[i.ingredient_id]["base_unit_id"]
            if i.unit_id != base:
                pairs.add((i.unit_id, base))
        for s in std_rows:
            base = (ing_map.get(s["ingredient_id"]) or {}).get("base_unit_id")
            if base and s["unit_id"] != base:
                pairs.add((s["unit_id"], base))
        cache = _build_conversion_cache(client, pairs)

        # Guard stok: SEMUA input harus cukup di division produksi, sebelum insert
        needs = []
        for i in body.inputs:
            base = ing_map[i.ingredient_id]["base_unit_id"]
            qty = float(i.qty_used)
            if i.unit_id != base:
                qty *= cache.get((i.unit_id, base), 1.0)
            needs.append((i.ingredient_id, prod_loc, qty))
        assert_sufficient_stock_many(needs, client)

        portions_theoretical = _multi_input_theoretical(
            body.process_id, body.inputs, std_rows, ing_map, cache, client
        )
        raw_qty_val, raw_unit_val = None, None
    else:
        # ── Jalur LEGACY single-raw ──────────────────────────────────────────
        if not proc_row.get("raw_ingredient_id"):
            raise HTTPException(
                status_code=422,
                detail="Proses ini multi-input — kirim daftar 'inputs', bukan raw_qty_used.",
            )

        unit_row = (
            client.table("units")
            .select("id")
            .eq("id", body.raw_unit_id)
            .maybe_single()
            .execute()
            .data
        )
        if not unit_row:
            raise HTTPException(status_code=422, detail=f"raw_unit_id '{body.raw_unit_id}' tidak ditemukan")

        ing_rows = (
            client.table("ingredients")
            .select("id, base_unit_id, division")
            .in_("id", [proc_row["raw_ingredient_id"], proc_row["output_ingredient_id"]])
            .execute()
            .data
        ) or []
        ing_map = {r["id"]: r for r in ing_rows}
        raw_base  = (ing_map.get(proc_row["raw_ingredient_id"]) or {}).get("base_unit_id")
        prod_loc  = _division_location((ing_map.get(proc_row["output_ingredient_id"]) or {}).get("division"))

        raw_qty_base = float(body.raw_qty_used)
        if raw_base and body.raw_unit_id != raw_base:
            cache = _build_conversion_cache(client, {(body.raw_unit_id, raw_base)})
            factor = cache.get((body.raw_unit_id, raw_base))
            if factor is not None:
                raw_qty_base *= factor

        assert_sufficient_stock(proc_row["raw_ingredient_id"], prod_loc, raw_qty_base, client)

        raw_qty_kg = _convert_raw_to_kg(float(body.raw_qty_used), body.raw_unit_id, client)
        yield_data           = get_theoretical_portions(body.process_id, raw_qty_kg, client)
        portions_theoretical = yield_data.get("theoretical_portions")  # None jika portion_size_g belum diset
        raw_qty_val, raw_unit_val = float(body.raw_qty_used), body.raw_unit_id

    # Kalkulasi yield & variance (blok sama untuk kedua jalur)
    if portions_theoretical and portions_theoretical > 0:
        yield_actual_pct = round(body.portions_actual / portions_theoretical * 100, 2)
        variance_pct     = round(
            (body.portions_actual - portions_theoretical) / portions_theoretical * 100, 2
        )
        is_flagged = abs(variance_pct) > settings.variance_threshold
    else:
        yield_actual_pct = None
        variance_pct     = None
        is_flagged       = False
        if not has_inputs and not proc_row.get("portion_size_g"):
            logger.warning(
                "Batch untuk process %s: portion_size_g belum diset, yield tidak dikalkulasi",
                body.process_id,
            )

    record = {
        "process_id":          body.process_id,
        "batch_date":          body.batch_date.isoformat(),
        "raw_qty_used":        raw_qty_val,
        "raw_unit_id":         raw_unit_val,
        "portions_actual":     body.portions_actual,
        "portions_theoretical": portions_theoretical,
        "yield_actual_pct":    yield_actual_pct,
        "variance_pct":        variance_pct,
        "is_flagged":          is_flagged,
        "processed_by":        body.processed_by,
        "notes":               body.notes,
        "created_by":          user["sub"],
    }

    inserted = (
        client.table("production_batches")
        .insert(record)
        .execute()
        .data[0]
    )
    batch_id = inserted["id"]

    if has_inputs:
        # Kompensasi manual (PostgREST tanpa transaksi lintas request): kalau
        # insert inputs gagal, hapus batch-nya. Kalau delete ini pun gagal,
        # batch yatim di-skip TOTAL oleh stock_level/variance (guard baca).
        try:
            client.table("batch_inputs").insert([
                {
                    "batch_id":      batch_id,
                    "ingredient_id": i.ingredient_id,
                    "qty_used":      float(i.qty_used),
                    "unit_id":       i.unit_id,
                }
                for i in body.inputs
            ]).execute()
        except Exception:
            client.table("production_batches").delete().eq("id", batch_id).execute()
            raise HTTPException(
                status_code=500,
                detail="Gagal menyimpan input batch — batch dibatalkan, tidak ada perubahan stok.",
            )

    # Fetch kembali dengan join untuk response lengkap
    row = (
        client.table("production_batches")
        .select(SELECT_BATCH)
        .eq("id", batch_id)
        .single()
        .execute()
        .data
    )
    flat = _flatten_batch(row)
    flat["inputs"] = _load_batch_inputs(client, batch_id)
    return flat


@router.get("/batches", response_model=list[BatchResponse])
def list_batches(
    date_from:  Optional[date] = Query(None),
    date_to:    Optional[date] = Query(None),
    process_id: Optional[str]  = Query(None),
    flagged:    Optional[bool]  = Query(None, description="True = hanya yang di-flag"),
    user=Depends(get_current_user),
):
    """
    Daftar production batches dengan filter opsional.
    Default: semua batch, diurutkan batch_date desc → process_name.
    """
    if date_from and date_to and date_from > date_to:
        raise HTTPException(status_code=422, detail="date_from harus <= date_to")

    client = get_supabase_admin()
    q = client.table("production_batches").select(SELECT_BATCH)

    if date_from:
        q = q.gte("batch_date", date_from.isoformat())
    if date_to:
        q = q.lte("batch_date", date_to.isoformat())
    if process_id:
        q = q.eq("process_id", process_id)
    if flagged is not None:
        q = q.eq("is_flagged", flagged)

    rows = q.order("batch_date", desc=True).execute().data
    return [_flatten_batch(r) for r in rows]


@router.get("/batches/{batch_id}", response_model=BatchResponse)
def get_batch(batch_id: str, user=Depends(get_current_user)):
    client = get_supabase_admin()
    row = (
        client.table("production_batches")
        .select(SELECT_BATCH)
        .eq("id", batch_id)
        .maybe_single()
        .execute()
        .data
    )
    if not row:
        raise HTTPException(status_code=404, detail="Batch tidak ditemukan")
    flat = _flatten_batch(row)
    flat["inputs"] = _load_batch_inputs(client, batch_id)
    return flat
