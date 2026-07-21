from pydantic import BaseModel, model_validator, field_validator
from typing import Optional, Literal
from datetime import date, datetime
from decimal import Decimal

Division = Literal["kitchen", "bar"]

VALID_CATEGORIES = {
    "breakfast", "snack", "main_course", "soup", "burger_sandwich",
    "pasta", "salad", "dessert", "rice_bowl",
    "beverage_coffee", "beverage_tea", "beverage_mocktail", "other",
}


class MenuBase(BaseModel):
    name: str
    category: str
    division: Division
    selling_price: Decimal
    is_active: bool = True
    is_seasonal: bool = False
    valid_from: Optional[date] = None
    valid_until: Optional[date] = None
    notes: Optional[str] = None

    @field_validator("selling_price")
    @classmethod
    def price_positive(cls, v: Decimal) -> Decimal:
        if v <= 0:
            raise ValueError("selling_price harus > 0")
        return v

    @model_validator(mode="after")
    def validate_seasonal(self) -> "MenuBase":
        if self.is_seasonal:
            if self.valid_from and self.valid_until and self.valid_from > self.valid_until:
                raise ValueError("valid_from harus <= valid_until")
        else:
            # Non-seasonal tidak boleh punya tanggal
            if self.valid_from or self.valid_until:
                raise ValueError("valid_from/valid_until hanya untuk menu seasonal (is_seasonal=true)")
        return self


class MenuCreate(MenuBase):
    pass


class MenuUpdate(BaseModel):
    name: Optional[str] = None
    category: Optional[str] = None
    division: Optional[Division] = None
    selling_price: Optional[Decimal] = None
    is_active: Optional[bool] = None
    is_seasonal: Optional[bool] = None
    valid_from: Optional[date] = None
    valid_until: Optional[date] = None
    notes: Optional[str] = None

    @field_validator("selling_price")
    @classmethod
    def price_positive(cls, v: Optional[Decimal]) -> Optional[Decimal]:
        if v is not None and v <= 0:
            raise ValueError("selling_price harus > 0")
        return v

    @model_validator(mode="after")
    def validate_seasonal_dates(self) -> "MenuUpdate":
        # Validasi hanya jika kedua tanggal hadir dalam payload ini
        if self.valid_from and self.valid_until and self.valid_from > self.valid_until:
            raise ValueError("valid_from harus <= valid_until")
        # Jika is_seasonal=False eksplisit, clear date fields
        if self.is_seasonal is False:
            self.valid_from = None
            self.valid_until = None
        return self


class MenuResponse(MenuBase):
    id: str
    created_at: datetime
    updated_at: datetime
