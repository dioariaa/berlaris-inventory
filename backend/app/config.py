from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    supabase_url: str
    supabase_anon_key: str
    supabase_service_role_key: str
    jwt_secret: str
    variance_threshold: float = 5.0
    # Default aman: kalau env var ENVIRONMENT tidak di-set di Vercel (misal lupa
    # atau typo), sistem fail-closed ke production (docs tertutup) — bukan
    # fail-open ke development (docs kebuka, seperti kejadian 2026-07-21).
    environment: str = "production"

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


settings = Settings()
