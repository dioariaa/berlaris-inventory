from pydantic import BaseModel, field_validator, model_validator
from typing import Optional
from datetime import date, datetime
from decimal import Decimal


# ── Stages ────────────────────────────────────────────────────────

class StageBase(BaseModel):
    stage_order: int
    stage_name: str
    yield_pct: Decimal
    notes: Optional[str] = None

    @field_validator("stage_order")
    @classmethod
    def order_positive(cls, v: int) -> int:
        if v < 1:
            raise ValueError("stage_order harus >= 1")
        return v

    @field_validator("yield_pct")
    @classmethod
    def yield_range(cls, v: Decimal) -> Decimal:
        if v <= 0 or v > 100:
            raise ValueError("yield_pct harus antara 0 dan 100 (eksklusif)")
        return v


class StageCreate(StageBase):
    pass


class StageUpdate(BaseModel):
    stage_order: Optional[int] = None
    stage_name: Optional[str] = None
    yield_pct: Optional[Decimal] = None
    notes: Optional[str] = None


class StageResponse(StageBase):
    id: str
    process_id: str
    created_at: datetime


# ── Outputs ───────────────────────────────────────────────────────

class OutputBase(BaseModel):
    output_ingredient_id: str
    output_qty_per_batch: Optional[Decimal] = None
    unit_id: str
    cost_allocation_pct: Decimal = Decimal("100")
    notes: Optional[str] = None

    @field_validator("cost_allocation_pct")
    @classmethod
    def allocation_range(cls, v: Decimal) -> Decimal:
        if v <= 0 or v > 100:
            raise ValueError("cost_allocation_pct harus antara 0 dan 100")
        return v


class OutputCreate(OutputBase):
    pass


class OutputUpdate(BaseModel):
    output_ingredient_id: Optional[str] = None
    output_qty_per_batch: Optional[Decimal] = None
    unit_id: Optional[str] = None
    cost_allocation_pct: Optional[Decimal] = None
    notes: Optional[str] = None


class OutputResponse(OutputBase):
    id: str
    process_id: str
    output_ingredient_name: Optional[str] = None
    unit_name: Optional[str] = None
    created_at: datetime


# ── Process ───────────────────────────────────────────────────────

class ProcessBase(BaseModel):
    name: str
    raw_ingredient_id: str
    output_ingredient_id: str
    portion_size_g: Optional[Decimal] = None
    is_active: bool = True
    notes: Optional[str] = None


class ProcessCreate(ProcessBase):
    stages: list[StageCreate] = []
    outputs: list[OutputCreate] = []

    @model_validator(mode="after")
    def stages_ordered(self) -> "ProcessCreate":
        orders = [s.stage_order for s in self.stages]
        if len(orders) != len(set(orders)):
            raise ValueError("stage_order harus unik dalam satu proses")
        return self


class ProcessUpdate(BaseModel):
    name: Optional[str] = None
    raw_ingredient_id: Optional[str] = None
    output_ingredient_id: Optional[str] = None
    portion_size_g: Optional[Decimal] = None
    is_active: Optional[bool] = None
    notes: Optional[str] = None


class ProcessResponse(ProcessBase):
    id: str
    raw_ingredient_name: Optional[str] = None
    output_ingredient_name: Optional[str] = None
    stages: list[StageResponse] = []
    outputs: list[OutputResponse] = []
    created_at: datetime
    updated_at: datetime


# ── Yield calculation result ──────────────────────────────────────

class YieldResult(BaseModel):
    process_id: str
    process_name: str
    stages: list[dict]
    cumulative_yield_pct: float
    portion_size_g: Optional[float]


# ── Production Batch ──────────────────────────────────────────────

class BatchCreate(BaseModel):
    process_id:     str
    batch_date:     date
    raw_qty_used:   Decimal
    raw_unit_id:    str
    portions_actual: int
    processed_by:   Optional[str] = None
    notes:          Optional[str] = None

    @field_validator("raw_qty_used")
    @classmethod
    def raw_qty_positive(cls, v: Decimal) -> Decimal:
        if v <= 0:
            raise ValueError("raw_qty_used harus > 0")
        return v

    @field_validator("portions_actual")
    @classmethod
    def portions_non_negative(cls, v: int) -> int:
        if v < 0:
            raise ValueError("portions_actual tidak boleh negatif")
        return v


class BatchResponse(BaseModel):
    id:                   str
    process_id:           str
    process_name:         Optional[str] = None
    raw_ingredient_name:  Optional[str] = None
    output_ingredient_name: Optional[str] = None
    batch_date:           date
    raw_qty_used:         Decimal
    raw_unit_id:          str
    raw_unit_name:        Optional[str] = None
    portions_actual:      int
    portions_theoretical: Optional[Decimal] = None
    yield_actual_pct:     Optional[Decimal] = None
    variance_pct:         Optional[Decimal] = None
    is_flagged:           bool
    processed_by:         Optional[str] = None
    notes:                Optional[str] = None
    created_at:           datetime
