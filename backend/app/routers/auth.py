from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from jose import jwt

from app.config import settings
from app.dependencies import get_current_user
from app.services.supabase import get_supabase, get_supabase_admin

router = APIRouter()

TOKEN_EXPIRE_HOURS = 12


def _issue_token(user_id: str, email: str, role: str) -> str:
    payload = {
        "sub": user_id,
        "email": email,
        "role": role,
        "exp": datetime.now(timezone.utc) + timedelta(hours=TOKEN_EXPIRE_HOURS),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")


class LoginRequest(BaseModel):
    email: str
    password: str


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user_id: str
    email: str
    role: str


@router.post("/login", response_model=LoginResponse)
def login(body: LoginRequest):
    # 1. Verifikasi email+password via Supabase Auth
    try:
        auth_resp = get_supabase().auth.sign_in_with_password(
            {"email": body.email, "password": body.password}
        )
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Email atau password salah",
        )

    if not auth_resp.user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Email atau password salah",
        )

    # 2. Ambil role dari tabel users
    row = (
        get_supabase_admin()
        .table("users")
        .select("id, email, role, is_active")
        .eq("email", body.email)
        .maybe_single()
        .execute()
    )

    if not row.data:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User tidak terdaftar di sistem Berlaris",
        )

    user = row.data

    # User yang dinonaktifkan tidak boleh dapat token — walau kredensial Supabase
    # Auth-nya masih valid.
    if not user.get("is_active", False):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Akun Anda dinonaktifkan — hubungi admin",
        )

    token = _issue_token(user["id"], user["email"], user["role"])

    return LoginResponse(
        access_token=token,
        user_id=user["id"],
        email=user["email"],
        role=user["role"],
    )


class RefreshRequest(BaseModel):
    refresh_token: str


@router.post("/refresh")
def refresh_token(body: RefreshRequest):
    try:
        resp = get_supabase().auth.refresh_session(body.refresh_token)
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Refresh token tidak valid",
        )

    row = (
        get_supabase_admin()
        .table("users")
        .select("id, email, role, is_active")
        .eq("email", resp.user.email)
        .maybe_single()
        .execute()
    )
    if not row.data:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="User tidak ditemukan")

    user = row.data
    if not user.get("is_active", False):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Akun Anda dinonaktifkan — hubungi admin",
        )

    token = _issue_token(user["id"], user["email"], user["role"])
    return {"access_token": token, "token_type": "bearer"}


@router.get("/me")
def me(user: dict = Depends(get_current_user)):
    """Verify token dan return info user — dipakai frontend saat app load."""
    return {"user_id": user["sub"], "email": user["email"], "role": user["role"]}
