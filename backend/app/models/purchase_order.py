from pydantic import BaseModel
from datetime import date, datetime
from decimal import Decimal
from typing import Optional


class POItem(BaseModel):
    ingredient_id: str
    qty_ordered: Decimal
    unit_id: str
    unit_price: Decimal


class PurchaseOrderCreate(BaseModel):
    vendor_id: str
    expected_delivery: Optional[date] = None
    notes: Optional[str] = None
    items: list[POItem]


class PurchaseOrderResponse(BaseModel):
    id: str
    po_number: str
    vendor_id: str
    status: str  # draft, sent, received, cancelled
    total_amount: Decimal
    created_at: datetime


class GoodsReceiptItem(BaseModel):
    po_item_id: str
    qty_received: Decimal
    unit_price_actual: Decimal


class GoodsReceiptCreate(BaseModel):
    po_id: str
    receipt_date: date
    notes: Optional[str] = None
    items: list[GoodsReceiptItem]
