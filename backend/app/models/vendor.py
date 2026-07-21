from pydantic import BaseModel, field_validator
from typing import Optional
from datetime import datetime
from decimal import Decimal


class VendorBase(BaseModel):
    name: str
    contact_name: Optional[str] = None
    contact_phone: Optional[str] = None
    address: Optional[str] = None
    lead_time_days: int = 1
    payment_terms: Optional[str] = None
    is_active: bool = True
    notes: Optional[str] = None

    @field_validator("lead_time_days")
    @classmethod
    def lead_time_non_negative(cls, v: int) -> int:
        if v < 0:
            raise ValueError("lead_time_days tidak boleh negatif")
        return v


class VendorCreate(VendorBase):
    pass


class VendorUpdate(BaseModel):
    name: Optional[str] = None
    contact_name: Optional[str] = None
    contact_phone: Optional[str] = None
    address: Optional[str] = None
    lead_time_days: Optional[int] = None
    payment_terms: Optional[str] = None
    is_active: Optional[bool] = None
    notes: Optional[str] = None

    @field_validator("lead_time_days")
    @classmethod
    def lead_time_non_negative(cls, v: Optional[int]) -> Optional[int]:
        if v is not None and v < 0:
            raise ValueError("lead_time_days tidak boleh negatif")
        return v


class VendorResponse(VendorBase):
    id: str
    created_at: datetime
    updated_at: datetime


# ── ingredient_vendors ─────────────────────────────────────────────

class IngredientVendorLink(BaseModel):
    ingredient_id: str
    is_primary_vendor: bool = False
    last_price_per_unit: Optional[Decimal] = None
    unit_id: Optional[str] = None
    notes: Optional[str] = None

    @field_validator("last_price_per_unit")
    @classmethod
    def price_non_negative(cls, v: Optional[Decimal]) -> Optional[Decimal]:
        if v is not None and v < 0:
            raise ValueError("last_price_per_unit tidak boleh negatif")
        return v


class IngredientVendorUpdate(BaseModel):
    is_primary_vendor: Optional[bool] = None
    last_price_per_unit: Optional[Decimal] = None
    unit_id: Optional[str] = None
    notes: Optional[str] = None

    @field_validator("last_price_per_unit")
    @classmethod
    def price_non_negative(cls, v: Optional[Decimal]) -> Optional[Decimal]:
        if v is not None and v < 0:
            raise ValueError("last_price_per_unit tidak boleh negatif")
        return v


class IngredientVendorResponse(BaseModel):
    id: str
    vendor_id: str
    ingredient_id: str
    ingredient_name: Optional[str] = None
    ingredient_type: Optional[str] = None
    is_primary_vendor: bool
    last_price_per_unit: Optional[Decimal] = None
    unit_id: Optional[str] = None
    unit_name: Optional[str] = None
    notes: Optional[str] = None
    updated_at: datetime
