from pydantic import BaseModel, field_validator
from datetime import date, datetime
from decimal import Decimal
from typing import Optional


# ── request models ─────────────────────────────────────────────────────────────

VALID_ENTRY_TYPES = ("sale", "complimentary", "test")


class SalesEntryItem(BaseModel):
    menu_id: str
    qty_sold: int
    entry_type: str = "sale"
    notes: Optional[str] = None

    @field_validator("qty_sold")
    @classmethod
    def qty_non_negative(cls, v: int) -> int:
        if v < 0:
            raise ValueError("qty_sold tidak boleh negatif")
        return v

    @field_validator("entry_type")
    @classmethod
    def validate_entry_type(cls, v: str) -> str:
        if v not in VALID_ENTRY_TYPES:
            raise ValueError(f"entry_type harus salah satu dari: {', '.join(VALID_ENTRY_TYPES)}")
        return v


class SalesEntrySubmit(BaseModel):
    entry_date: date
    entries: list[SalesEntryItem]

    @field_validator("entries")
    @classmethod
    def entries_not_empty(cls, v: list) -> list:
        if not v:
            raise ValueError("entries tidak boleh kosong")
        return v


# ── response models ────────────────────────────────────────────────────────────

class MenuWithQty(BaseModel):
    menu_id: str
    name: str
    category: str
    selling_price: Decimal
    # qty per entry type (0 jika belum ada)
    qty_sale: int = 0
    qty_complimentary: int = 0
    qty_test: int = 0
    # entry ids untuk upsert
    entry_id_sale: Optional[str] = None
    entry_id_complimentary: Optional[str] = None
    entry_id_test: Optional[str] = None


class MenuGroupByCategory(BaseModel):
    category: str
    menus: list[MenuWithQty]


class SalesEntryTodayResponse(BaseModel):
    entry_date: date
    groups: list[MenuGroupByCategory]
    total_menu_types: int
    total_filled: int  # berapa menu yang sudah di-isi qty


class SalesEntrySummary(BaseModel):
    entry_date: date
    total_menu_types: int
    total_porsi: int
    estimated_revenue: Decimal          # hanya dari entry_type='sale'
    complimentary_porsi: int = 0
    test_porsi: int = 0
    ingredients_recalculated: int
