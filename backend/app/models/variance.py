from pydantic import BaseModel
from datetime import date
from decimal import Decimal
from typing import Optional


class VarianceReport(BaseModel):
    id: str
    report_date: date
    ingredient_id: str
    ingredient_name: str
    opening_qty: Decimal
    production_in_qty: Decimal
    theoretical_out_qty: Decimal
    theoretical_closing: Decimal
    actual_closing: Decimal
    variance_qty: Decimal
    variance_pct: Decimal
    is_flagged: bool
    notes: Optional[str] = None
