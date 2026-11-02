"""Invite emails through Supabase Auth's admin API (it sends the magic link)."""

from __future__ import annotations

import logging
import os

import httpx

log = logging.getLogger("app.projects.invites")


async def send_invite_email(email: str, transport: httpx.AsyncBaseTransport | None = None) -> bool:
    """True if Supabase accepted the invite. Without SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY the
    invite is only stored; it's accepted when that email signs in."""
    url, key = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        return False
    try:
        async with httpx.AsyncClient(timeout=10, transport=transport) as c:
            r = await c.post(
                f"{url.rstrip('/')}/auth/v1/invite",
                json={"email": email},
                headers={"apikey": key, "Authorization": f"Bearer {key}"},
            )
    except httpx.HTTPError as e:
        log.warning("invite email failed: %s", e)
        return False
    if r.status_code >= 400:
        log.warning("invite email refused (%s): %s", r.status_code, r.text[:200])
        return False
    return True
