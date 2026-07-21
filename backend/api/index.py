# Entry point Vercel Python serverless — expose ASGI app FastAPI.
# Semua request di-rewrite ke sini oleh vercel.json; routing tetap di FastAPI.
from app.main import app  # noqa: F401
