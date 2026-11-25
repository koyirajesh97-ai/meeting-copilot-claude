"""Verify a Supabase Auth access token (the desktop app signs in with Supabase, then trades the
session for a short-lived backend token).

Supports both Supabase signing modes:
  * SUPABASE_JWT_SECRET set: legacy HS256 shared secret (older local stacks).
  * otherwise: asymmetric keys from SUPABASE_URL/auth/v1/.well-known/jwks.json.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from functools import lru_cache

import httpx
import jwt

log = logging.getLogger("app.auth")


class SupabaseTokenError(Exception):
    pass


@dataclass(frozen=True)
class SupabaseUser:
    id: str
    email: str | None
    #: Supabase says this address was confirmed (a link was clicked, or Google vouched for it).
    #: None: the token doesn't say; ask Supabase with `email_confirmed`.
    email_verified: bool | None = None


@lru_cache(maxsize=4)
def _jwks_client(url: str) -> jwt.PyJWKClient:
    return jwt.PyJWKClient(
        f"{url.rstrip('/')}/auth/v1/.well-known/jwks.json", cache_keys=True, lifespan=3600
    )


def verify_supabase_token(token: str) -> SupabaseUser:
    secret = os.environ.get("SUPABASE_JWT_SECRET")
    options = {"require": ["exp", "sub"]}
    try:
        if secret:
            claims = jwt.decode(
                token, secret, algorithms=["HS256"], audience="authenticated", options=options
            )
        else:
            url = os.environ.get("SUPABASE_URL")
            if not url:
                raise SupabaseTokenError(
                    "Set SUPABASE_URL (or SUPABASE_JWT_SECRET) so sign-ins can be verified"
                )
            key = _jwks_client(url).get_signing_key_from_jwt(token)
            claims = jwt.decode(
                token,
                key.key,
                algorithms=["ES256", "RS256"],
                audience="authenticated",
                options=options,
            )
    except jwt.PyJWTError as e:
        raise SupabaseTokenError(str(e)) from e
    if claims.get("role") != "authenticated":
        raise SupabaseTokenError("not a signed-in user session")
    meta = claims.get("user_metadata")
    verified = meta.get("email_verified") if isinstance(meta, dict) else None
    return SupabaseUser(
        id=claims["sub"],
        email=claims.get("email") or None,
        email_verified=verified if isinstance(verified, bool) else None,
    )


async def email_confirmed(user_id: str, transport: httpx.AsyncBaseTransport | None = None) -> bool:
    """Whether Supabase Auth has confirmed this user's email (admin API; needs SUPABASE_URL and
    SUPABASE_SERVICE_ROLE_KEY). False when it can't tell: an unconfirmed address must never be
    trusted for project invites, which are matched by email."""
    url, key = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        return False
    try:
        async with httpx.AsyncClient(timeout=10, transport=transport) as c:
            r = await c.get(
                f"{url.rstrip('/')}/auth/v1/admin/users/{user_id}",
                headers={"apikey": key, "Authorization": f"Bearer {key}"},
            )
    except httpx.HTTPError as e:
        log.warning("couldn't check email confirmation: %s", e)
        return False
    if r.status_code != 200:
        log.warning("email confirmation check refused (%s)", r.status_code)
        return False
    return bool(r.json().get("email_confirmed_at"))
