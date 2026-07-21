from pydantic import BaseModel, field_validator
from typing import Optional, Literal
from datetime import datetime
from decimal import Decimal

IngredientType = Literal["raw", "processed", "packaging"]
Division = Literal["kitchen", "bar", "both"]


class IngredientBase(BaseModel):
    name: str
    ingredient_type: IngredientType
    division: Division
    base_unit_id: str
    avg_cost_per_unit: Decimal = Decimal("0")
    portion_size_g: Optional[Decimal] = None
    min_threshold: Optional[Decimal] = None
    package_size: Optional[str] = None
    purchase_unit: Optional[str] = None
    conversion_factor: Decimal = Decimal("1")
    is_active: bool = True
    notes: Optional[str] = None

    @field_validator("avg_cost_per_unit")
    @classmethod
    def cost_non_negative(cls, v: Decimal) -> Decimal:
        if v < 0:
            raise ValueError("avg_cost_per_unit tidak boleh negatif")
        return v


class IngredientCreate(IngredientBase):
    pass


class IngredientUpdate(BaseModel):
    name: Optional[str] = None
    ingredient_type: Optional[IngredientType] = None
    division: Optional[Division] = None
    base_unit_id: Optional[str] = None
    avg_cost_per_unit: Optional[Decimal] = None
    portion_size_g: Optional[Decimal] = None
    min_threshold: Optional[Decimal] = None
    package_size: Optional[str] = None
    purchase_unit: Optional[str] = None
    conversion_factor: Optional[Decimal] = None
    is_active: Optional[bool] = None
    notes: Optional[str] = None


class IngredientResponse(IngredientBase):
    id: str
    base_unit_name: Optional[str] = None
    base_unit_symbol: Optional[str] = None
    created_at: datetime
    updated_at: datetime
