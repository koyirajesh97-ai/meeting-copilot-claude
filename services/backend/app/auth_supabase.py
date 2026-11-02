"""Verify a Supabase Auth access token (the desktop app signs in with Supabase, then trades the
session for a short-lived backend token).

Supports both Supabase signing modes:
  * SUPABASE_JWT_SECRET set: legacy HS256 shared secret (older local stacks).
  * otherwise: asymmetric keys from SUPABASE_URL/auth/v1/.well-known/jwks.json.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache

import jwt


class SupabaseTokenError(Exception):
    pass


@dataclass(frozen=True)
class SupabaseUser:
    id: str
    email: str | None


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
    return SupabaseUser(id=claims["sub"], email=claims.get("email"))
