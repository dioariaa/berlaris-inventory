from pydantic import BaseModel, field_validator
from typing import Optional
from datetime import datetime
from decimal import Decimal


class UnitBase(BaseModel):
    name: str
    symbol: str


class UnitCreate(UnitBase):
    pass


class UnitUpdate(BaseModel):
    name: Optional[str] = None
    symbol: Optional[str] = None


class UnitResponse(UnitBase):
    id: str
    created_at: datetime


class ConversionBase(BaseModel):
    from_unit_id: str
    to_unit_id: str
    factor: Decimal
    notes: Optional[str] = None

    @field_validator("factor")
    @classmethod
    def factor_must_be_positive(cls, v: Decimal) -> Decimal:
        if v <= 0:
            raise ValueError("factor harus > 0")
        return v


class ConversionCreate(ConversionBase):
    pass


class ConversionUpdate(BaseModel):
    factor: Optional[Decimal] = None
    notes: Optional[str] = None

    @field_validator("factor")
    @classmethod
    def factor_must_be_positive(cls, v: Optional[Decimal]) -> Optional[Decimal]:
        if v is not None and v <= 0:
            raise ValueError("factor harus > 0")
        return v


class ConversionResponse(ConversionBase):
    id: str
    created_at: datetime
    # Join fields (optional, ada jika query pakai select dengan join)
    from_unit_name: Optional[str] = None
    to_unit_name: Optional[str] = None
