from pydantic import BaseModel, field_validator
from typing import Optional
from datetime import datetime
from decimal import Decimal


class RecipeItemIn(BaseModel):
    ingredient_id: str
    qty: Decimal
    unit_id: str
    notes: Optional[str] = None

    @field_validator("qty")
    @classmethod
    def qty_positive(cls, v: Decimal) -> Decimal:
        if v <= 0:
            raise ValueError("qty harus > 0")
        return v


class RecipeSetRequest(BaseModel):
    items: list[RecipeItemIn]


class RecipeItemResponse(BaseModel):
    id: str
    menu_id: str
    ingredient_id: str
    ingredient_name: str
    ingredient_type: str
    qty: Decimal
    unit_id: str
    unit_name: str
    unit_symbol: str
    notes: Optional[str] = None
    created_at: datetime
    updated_at: datetime


# ── Bulk import ───────────────────────────────────────────────────

class BulkImportRow(BaseModel):
    row: int
    menu_name: str
    ingredient_name: str
    qty: float
    unit_name: str
    menu_id: Optional[str] = None
    ingredient_id: Optional[str] = None
    unit_id: Optional[str] = None


class BulkImportPreview(BaseModel):
    success: list[BulkImportRow]
    errors: list[dict]        # [{row, menu, bahan, satuan, reason}]
    total_rows: int
    success_count: int
    error_count: int
    import_token: str         # UUID sementara untuk confirm endpoint


class BulkImportConfirm(BaseModel):
    import_token: str


class BulkImportResult(BaseModel):
    inserted: int
    menus_affected: int
    errors: list[dict]
