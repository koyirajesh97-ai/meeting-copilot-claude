"""Trade a Supabase session for a short-lived backend token; who am I."""

from __future__ import annotations

import os
import time
import uuid

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel

from app.auth import SESSION_TTL_S, CurrentUser, issue_token
from app.auth_supabase import SupabaseTokenError, verify_supabase_token
from app.services import services

router = APIRouter()

DEV_USER_ID = str(uuid.UUID("00000000-0000-4000-8000-000000000001"))
DEV_USER_EMAIL = "dev@localhost"


def dev_login_enabled() -> bool:
    """Opt-in for local development and end-to-end tests. Never set ALLOW_DEV_LOGIN in production."""
    return os.environ.get("ALLOW_DEV_LOGIN") == "1"


class SessionIn(BaseModel):
    access_token: str


class SessionOut(BaseModel):
    token: str
    expires_at: int
    user_id: str
    email: str | None


class Me(BaseModel):
    id: str
    email: str | None


async def _signed_in(user_id: str, email: str | None, ensure_auth_user: bool = False) -> None:
    """Record the user and turn any pending project invites for their email into memberships."""
    s = services()
    await s.meetings.upsert_user(user_id, email, ensure_auth_user=ensure_auth_user)
    await s.projects.register_user(user_id, email)
    await s.projects.accept_invites(user_id, email)


@router.post("/auth/session", response_model=SessionOut)
async def create_session(body: SessionIn) -> SessionOut:
    try:
        user = verify_supabase_token(body.access_token)
    except SupabaseTokenError as e:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, f"Sign-in not accepted: {e}") from e
    await _signed_in(user.id, user.email)
    return SessionOut(
        token=issue_token(user.id, email=user.email),
        expires_at=int(time.time()) + SESSION_TTL_S,
        user_id=user.id,
        email=user.email,
    )


@router.post("/auth/dev-session", response_model=SessionOut)
async def dev_session(request: Request) -> SessionOut:
    """A fixed local user, without Supabase. Only with ALLOW_DEV_LOGIN=1 and only from this machine."""
    client = request.client.host if request.client else ""
    if not dev_login_enabled() or client not in {"127.0.0.1", "::1", "localhost", "testclient"}:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")
    await _signed_in(DEV_USER_ID, DEV_USER_EMAIL, ensure_auth_user=True)
    return SessionOut(
        token=issue_token(DEV_USER_ID, email=DEV_USER_EMAIL),
        expires_at=int(time.time()) + SESSION_TTL_S,
        user_id=DEV_USER_ID,
        email=DEV_USER_EMAIL,
    )


@router.get("/me", response_model=Me)
async def me(user: CurrentUser) -> Me:
    return Me(id=user.user_id, email=user.email)
