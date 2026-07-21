import logging
import re

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from app.config import settings

logger = logging.getLogger(__name__)

app = FastAPI(
    title="Berlaris Inventory API",
    version="1.0.0",
    docs_url="/docs" if settings.environment == "development" else None,
)

ALLOWED_ORIGINS      = ["https://berlaris.vercel.app"]
ALLOWED_ORIGIN_REGEX = r"http://localhost:\d+" if settings.environment == "development" else None

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_origin_regex=ALLOWED_ORIGIN_REGEX,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    """
    500 default FastAPI TIDAK melewati CORSMiddleware — browser salah
    melaporkannya sebagai 'blocked by CORS policy' dan menyembunyikan error
    aslinya. Handler ini mengembalikan JSON 500 + header CORS manual supaya
    frontend melihat pesan error yang sebenarnya.
    """
    logger.exception("Unhandled error di %s %s", request.method, request.url.path)
    origin  = request.headers.get("origin", "")
    allowed = origin in ALLOWED_ORIGINS or (
        ALLOWED_ORIGIN_REGEX and re.fullmatch(ALLOWED_ORIGIN_REGEX, origin)
    )
    headers = (
        {"Access-Control-Allow-Origin": origin, "Access-Control-Allow-Credentials": "true"}
        if allowed else {}
    )
    return JSONResponse(
        status_code=500,
        content={"detail": f"Server error: {type(exc).__name__}: {exc}"},
        headers=headers,
    )


@app.get("/")
def root():
    from app.services.supabase import test_connection
    try:
        units_count = test_connection()
        return {"status": "ok", "db_connected": True, "units_count": units_count}
    except Exception as e:
        return {"status": "error", "db_connected": False, "detail": str(e)}


@app.get("/health")
def health_check():
    return {"status": "ok", "environment": settings.environment}


from app.routers import (
    auth, ingredients, units, menus, vendors, production,
    sales_entry, opname, calculate, dashboard,
    purchase_orders, goods_receipts, reports, waste, stock,
    hpp_analysis, transfers,
)

app.include_router(auth.router, prefix="/auth", tags=["auth"])
app.include_router(ingredients.router, prefix="/ingredients", tags=["ingredients"])
app.include_router(units.router, prefix="/units", tags=["units"])
app.include_router(menus.router, prefix="/menus", tags=["menus"])
app.include_router(vendors.router, prefix="/vendors", tags=["vendors"])
app.include_router(production.router, prefix="/production", tags=["production"])
app.include_router(sales_entry.router, prefix="/sales-entry", tags=["sales-entry"])
app.include_router(opname.router, prefix="/opname", tags=["opname"])
app.include_router(calculate.router, prefix="/calculate", tags=["calculate"])
app.include_router(dashboard.router, prefix="/dashboard", tags=["dashboard"])
app.include_router(purchase_orders.router, prefix="/purchase-orders", tags=["purchase-orders"])
app.include_router(goods_receipts.router, prefix="/goods-receipts", tags=["goods-receipts"])
app.include_router(reports.router, prefix="/reports", tags=["reports"])
app.include_router(waste.router, prefix="/waste", tags=["waste"])
app.include_router(stock.router, prefix="/stock", tags=["stock"])
app.include_router(hpp_analysis.router, prefix="/hpp-analysis", tags=["HPP Analysis"])
app.include_router(transfers.router, prefix="/transfers", tags=["transfers"])
