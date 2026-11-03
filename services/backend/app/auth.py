"""Short-lived backend tokens (HS256 JWT signed with BACKEND_SECRET).

The desktop app never holds API keys; it holds one of these. Every route except /health
needs one. Meeting WebSockets use a narrower token scoped to one meeting.
"""

from __future__ import annotations

import logging
import os
import secrets
import time
from dataclasses import dataclass
from functools import lru_cache
from typing import Annotated, Literal

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

log = logging.getLogger("app.auth")

ISSUER = "meeting-copilot-backend"
SESSION_TTL_S = 60 * 60  # 1 hour
WS_TTL_S = 5 * 60  # enough to connect; reconnects ask for a fresh one

Scope = Literal["api", "ws", "watch", "oauth", "share"]


@lru_cache(maxsize=1)
def backend_secret() -> str:
    secret = os.environ.get("BACKEND_SECRET")
    if secret:
        if len(secret) < 32:
            raise RuntimeError("BACKEND_SECRET must be at least 32 characters")
        return secret
    log.warning("BACKEND_SECRET is not set; using a random secret (tokens won't survive a restart)")
    return secrets.token_urlsafe(48)


@dataclass(frozen=True)
class Principal:
    user_id: str
    email: str | None = None
    meeting_id: str | None = None


def issue_token(
    user_id: str,
    *,
    scope: Scope = "api",
    email: str | None = None,
    meeting_id: str | None = None,
    ttl_s: int | None = None,
) -> str:
    now = int(time.time())
    claims = {
        "iss": ISSUER,
        "sub": user_id,
        "scope": scope,
        "iat": now,
        "exp": now
        + (ttl_s if ttl_s is not None else (SESSION_TTL_S if scope == "api" else WS_TTL_S)),
    }
    if email:
        claims["email"] = email
    if meeting_id:
        claims["mid"] = meeting_id
    return jwt.encode(claims, backend_secret(), algorithm="HS256")


class InvalidToken(Exception):
    pass


def verify_token(token: str, *, scope: Scope = "api", meeting_id: str | None = None) -> Principal:
    try:
        claims = jwt.decode(
            token,
            backend_secret(),
            algorithms=["HS256"],
            issuer=ISSUER,
            options={"require": ["exp", "sub"]},
        )
    except jwt.PyJWTError as e:
        raise InvalidToken(str(e)) from e
    if claims.get("scope") != scope:
        raise InvalidToken("wrong token scope")
    if meeting_id is not None and claims.get("mid") != meeting_id:
        raise InvalidToken("token is for a different meeting")
    return Principal(user_id=claims["sub"], email=claims.get("email"), meeting_id=claims.get("mid"))


_bearer = HTTPBearer(auto_error=False)


def current_user(
    creds: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
) -> Principal:
    if creds is None:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED, "Missing backend token", {"WWW-Authenticate": "Bearer"}
        )
    try:
        return verify_token(creds.credentials)
    except InvalidToken as e:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED, f"Invalid token: {e}", {"WWW-Authenticate": "Bearer"}
        ) from e


CurrentUser = Annotated[Principal, Depends(current_user)]
