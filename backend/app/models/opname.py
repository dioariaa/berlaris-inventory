from pydantic import BaseModel, field_validator
from typing import Optional
from datetime import date, datetime
from decimal import Decimal


class OpnameCount(BaseModel):
    ingredient_id: str
    physical_qty:  Decimal
    unit_id:       str
    notes:         Optional[str] = None

    @field_validator("physical_qty")
    @classmethod
    def qty_non_negative(cls, v: Decimal) -> Decimal:
        if v < 0:
            raise ValueError("physical_qty tidak boleh negatif")
        return v


class OpnameSubmit(BaseModel):
    opname_date: date
    counts: list[OpnameCount]

    @field_validator("counts")
    @classmethod
    def counts_not_empty(cls, v: list) -> list:
        if not v:
            raise ValueError("counts tidak boleh kosong")
        return v


class OpnameIngredientItem(BaseModel):
    ingredient_id:     str
    name:              str
    ingredient_type:   str
    division:          str
    base_unit_id:      str
    unit_name:         Optional[str] = None
    unit_symbol:       Optional[str] = None
    avg_cost_per_unit: Optional[Decimal] = None
    physical_qty:      Optional[Decimal] = None   # None = belum di-count hari ini
    opname_unit_id:    Optional[str] = None
    opname_id:         Optional[str] = None       # UUID of daily_stock_opname record
    notes:             Optional[str] = None
    counted_at:        Optional[datetime] = None


class OpnameDivisionGroup(BaseModel):
    division:    str
    ingredients: list[OpnameIngredientItem]


class OpnameTodayResponse(BaseModel):
    opname_date:       date
    groups:            list[OpnameDivisionGroup]
    total_ingredients: int
    total_counted:     int


class VarianceSummaryItem(BaseModel):
    ingredient_id:       str
    ingredient_name:     str
    division:            str
    variance_qty:        Decimal
    variance_pct:        Decimal
    is_flagged:          bool
    theoretical_closing: Optional[Decimal] = None
    actual_closing_qty:  Optional[Decimal] = None


class OpnameSubmitResponse(BaseModel):
    opname_date:      date
    saved:            int
    flagged:          int
    variance_summary: list[VarianceSummaryItem]   # top 5 terburuk


class StockAdjustmentRequest(BaseModel):
    reason: str

    @field_validator("reason")
    @classmethod
    def reason_not_empty(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("reason tidak boleh kosong")
        return v.strip()


class StockAdjustmentResponse(BaseModel):
    id:               str
    ingredient_id:    str
    ingredient_name:  str
    qty_delta:        Decimal
    reason:           str
    opname_id:        Optional[str] = None
    created_by_name:  str
    created_at:       datetime
