from supabase import create_client, Client
from app.config import settings

_anon_client: Client | None = None
_admin_client: Client | None = None


def get_supabase() -> Client:
    """Anon client — untuk operasi yang butuh user context (auth sign-in, dll)."""
    global _anon_client
    if _anon_client is None:
        _anon_client = create_client(settings.supabase_url, settings.supabase_anon_key)
    return _anon_client


def get_supabase_admin() -> Client:
    """Service role client — bypasses RLS. Untuk semua operasi server-side."""
    global _admin_client
    if _admin_client is None:
        _admin_client = create_client(settings.supabase_url, settings.supabase_service_role_key)
    return _admin_client


def test_connection() -> int:
    """Test koneksi DB, return jumlah units. Raise jika gagal."""
    result = get_supabase_admin().table("units").select("id", count="exact").execute()
    return result.count or 0
