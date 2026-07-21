"""
Guard stok negatif — SATU titik logic untuk semua movement keluar.

Dipanggil SEBELUM insert di: sales entry (theoretical_consumption),
production batch (raw material), waste log, dan stock transfer.

PENGECUALIAN DISENGAJA: stock_adjustments (koreksi manual dari opname) TIDAK
dikenai guard ini — adjustment tujuannya membetulkan ledger yang salah, kadang
perlu menarik angka ke bawah nol kalau ledger memang salah hitung sebelumnya.
"""
from fastapi import HTTPException
from supabase import Client

from app.services.stock_level import get_current_stock

LOCATION_LABEL = {
    "storage_bar": "Storage Bar", "storage_kitchen": "Storage Kitchen",
    "bar": "Bar", "kitchen": "Kitchen",
    "staff_meal": "Staff Meal", "operational": "Operational",
}


class InsufficientStockError(HTTPException):
    """Stok tidak cukup di lokasi yang diminta. Subclass HTTPException → FastAPI
    otomatis mengembalikan 400 dengan pesan yang jelas untuk admin."""
    def __init__(self, detail: str):
        super().__init__(status_code=400, detail=detail)


def _fmt(qty: float, symbol: str) -> str:
    q = round(qty, 3)
    q = int(q) if q == int(q) else q
    return f"{q} {symbol}".strip()


def assert_sufficient_stock_many(
    needs: list[tuple[str, str, float]],
    client: Client | None = None,
) -> None:
    """
    needs: list of (ingredient_id, location, qty_needed) — qty dalam base unit.
    Raise InsufficientStockError kalau ADA yang kurang (pesan gabungan semua
    kekurangan), sebelum caller insert apa pun.

    ponytail: check-then-write tanpa row lock — PostgREST tidak support
    SELECT FOR UPDATE. Kalau race condition jadi masalah nyata (multi-admin
    submit barengan), pindahkan guard+insert ke Postgres function (RPC)
    dengan FOR UPDATE.
    """
    needs = [n for n in needs if n[2] > 0]
    if not needs:
        return

    ids = list({n[0] for n in needs})
    stock = {r["ingredient_id"]: r for r in get_current_stock(ids, client)}

    shortages = []
    for iid, location, qty_needed in needs:
        row = stock.get(iid)
        if row is None:
            shortages.append(f"Ingredient {iid} tidak ditemukan/nonaktif")
            continue
        available = row["locations"].get(location, 0.0)
        if available - qty_needed < -1e-9:
            symbol = row["unit_symbol"] or ""
            loc = LOCATION_LABEL.get(location, location)
            shortages.append(
                f"{row['ingredient_name']} - {loc}: stok tersedia {_fmt(available, symbol)}, "
                f"butuh {_fmt(qty_needed, symbol)}, kurang {_fmt(qty_needed - available, symbol)}"
            )

    if shortages:
        raise InsufficientStockError(
            "Stok tidak cukup — transfer dari storage dulu. " + "; ".join(shortages)
        )


def assert_sufficient_stock(
    ingredient_id: str,
    location: str,
    qty_needed: float,
    client: Client | None = None,
) -> None:
    """Varian satu-ingredient. Logic-nya di assert_sufficient_stock_many."""
    assert_sufficient_stock_many([(ingredient_id, location, qty_needed)], client)
