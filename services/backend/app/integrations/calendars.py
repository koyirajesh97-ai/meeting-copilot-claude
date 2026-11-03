"""Google Calendar and Microsoft Graph calendars over OAuth 2.0 (authorization code + refresh).

Client IDs and secrets come from the environment (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET,
MICROSOFT_CLIENT_ID / MICROSOFT_CLIENT_SECRET); each user's refresh token is stored encrypted."""

from __future__ import annotations

import os
import time
from datetime import UTC, datetime
from urllib.parse import urlencode

import httpx

from .base import CalendarEvent, IntegrationError, Kind

OAUTH = {
    "google": {
        "authorize": "https://accounts.google.com/o/oauth2/v2/auth",
        "token": "https://oauth2.googleapis.com/token",
        "scope": "https://www.googleapis.com/auth/calendar.readonly",
        "env": "GOOGLE",
        "extra": {"access_type": "offline", "prompt": "consent"},
    },
    "microsoft": {
        "authorize": "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
        "token": "https://login.microsoftonline.com/common/oauth2/v2.0/token",
        "scope": "offline_access Calendars.Read",
        "env": "MICROSOFT",
        "extra": {},
    },
}


def client_creds(kind: Kind) -> tuple[str, str] | None:
    env = OAUTH[kind]["env"]
    cid, secret = os.environ.get(f"{env}_CLIENT_ID"), os.environ.get(f"{env}_CLIENT_SECRET")
    return (cid, secret) if cid and secret else None


def authorize_url(kind: Kind, redirect_uri: str, state: str) -> str:
    creds = client_creds(kind)
    if not creds:
        raise IntegrationError(
            f"Set {OAUTH[kind]['env']}_CLIENT_ID and _CLIENT_SECRET on the backend first."
        )
    o = OAUTH[kind]
    q = {
        "client_id": creds[0],
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": o["scope"],
        "state": state,
        **o["extra"],
    }
    return f"{o['authorize']}?{urlencode(q)}"


async def exchange_code(kind: Kind, code: str, redirect_uri: str, transport=None) -> dict:
    """Code -> {refresh_token, access_token, expires_at}."""
    cid, secret = client_creds(kind) or ("", "")
    async with httpx.AsyncClient(transport=transport, timeout=15) as c:
        r = await c.post(
            OAUTH[kind]["token"],
            data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": redirect_uri,
                "client_id": cid,
                "client_secret": secret,
            },
        )
    if r.status_code != 200:
        raise IntegrationError(f"{kind} sign-in failed: {r.status_code} {r.text[:200]}")
    j = r.json()
    if not j.get("refresh_token"):
        raise IntegrationError(
            f"{kind} didn't return a refresh token; remove the app's access and connect again."
        )
    return {
        "refresh_token": j["refresh_token"],
        "access_token": j.get("access_token"),
        "expires_at": time.time() + float(j.get("expires_in", 3600)),
    }


async def access_token(kind: Kind, creds: dict, transport=None) -> tuple[str, dict | None]:
    """A valid access token, and the updated credentials if it had to be refreshed."""
    if creds.get("access_token") and creds.get("expires_at", 0) - 60 > time.time():
        return creds["access_token"], None
    cid, secret = client_creds(kind) or ("", "")
    async with httpx.AsyncClient(transport=transport, timeout=15) as c:
        r = await c.post(
            OAUTH[kind]["token"],
            data={
                "grant_type": "refresh_token",
                "refresh_token": creds.get("refresh_token", ""),
                "client_id": cid,
                "client_secret": secret,
            },
        )
    if r.status_code in (400, 401):
        raise IntegrationError(
            f"{kind} access was revoked or expired; connect again.", reconnect=True
        )
    if r.status_code != 200:
        raise IntegrationError(f"{kind} token refresh failed: {r.status_code}")
    j = r.json()
    new = {
        **creds,
        "access_token": j["access_token"],
        "expires_at": time.time() + float(j.get("expires_in", 3600)),
    }
    if j.get("refresh_token"):
        new["refresh_token"] = j["refresh_token"]  # Microsoft rotates refresh tokens
    return new["access_token"], new


def _iso(t: float) -> str:
    return datetime.fromtimestamp(t, UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def _parse(s: str | None) -> float:
    if not s:
        return 0.0
    s = s.replace("Z", "+00:00")
    if "." in s:  # Graph sends 7 fractional digits
        head, _, tail = s.partition(".")
        frac = "".join(ch for ch in tail if ch.isdigit())[:6]
        tz = tail[len("".join(ch for ch in tail if ch.isdigit())) :]
        s = f"{head}.{frac}{tz}"
    d = datetime.fromisoformat(s)
    return (d if d.tzinfo else d.replace(tzinfo=UTC)).timestamp()


class GoogleCalendar:
    API = "https://www.googleapis.com/calendar/v3/calendars/primary/events"

    def __init__(self, transport=None) -> None:
        self.transport = transport
        #: Set when a refresh produced new credentials (the caller stores them).
        self.updated_creds: dict | None = None

    async def upcoming(self, creds: dict, start: float, end: float) -> list[CalendarEvent]:
        token, self.updated_creds = await access_token("google", creds, self.transport)
        async with httpx.AsyncClient(transport=self.transport, timeout=15) as c:
            r = await c.get(
                self.API,
                headers={"Authorization": f"Bearer {token}"},
                params={
                    "timeMin": _iso(start),
                    "timeMax": _iso(end),
                    "singleEvents": "true",
                    "orderBy": "startTime",
                    "maxResults": "50",
                },
            )
        if r.status_code == 401:
            raise IntegrationError("Google Calendar access expired; connect again.", reconnect=True)
        if r.status_code != 200:
            raise IntegrationError(f"Google Calendar: {r.status_code}")
        out = []
        for e in r.json().get("items", []):
            st, en = e.get("start", {}), e.get("end", {})
            if "dateTime" not in st or e.get("status") == "cancelled":
                continue  # all-day events aren't meetings
            out.append(
                CalendarEvent(
                    id=f"google:{e['id']}",
                    source="google",
                    title=e.get("summary") or "(no title)",
                    start=_parse(st["dateTime"]),
                    end=_parse(en.get("dateTime")),
                    attendees=len(e.get("attendees", [])),
                    description=(e.get("description") or "")[:2000],
                    join_url=e.get("hangoutLink"),
                )
            )
        return out


class MicrosoftCalendar:
    API = "https://graph.microsoft.com/v1.0/me/calendarView"

    def __init__(self, transport=None) -> None:
        self.transport = transport
        self.updated_creds: dict | None = None

    async def upcoming(self, creds: dict, start: float, end: float) -> list[CalendarEvent]:
        token, self.updated_creds = await access_token("microsoft", creds, self.transport)
        async with httpx.AsyncClient(transport=self.transport, timeout=15) as c:
            r = await c.get(
                self.API,
                headers={"Authorization": f"Bearer {token}", "Prefer": 'outlook.timezone="UTC"'},
                params={
                    "startDateTime": _iso(start),
                    "endDateTime": _iso(end),
                    "$top": "50",
                    "$orderby": "start/dateTime",
                    "$select": "id,subject,start,end,attendees,bodyPreview,isAllDay,isCancelled,onlineMeeting",
                },
            )
        if r.status_code == 401:
            raise IntegrationError(
                "Outlook calendar access expired; connect again.", reconnect=True
            )
        if r.status_code != 200:
            raise IntegrationError(f"Microsoft Graph: {r.status_code}")
        out = []
        for e in r.json().get("value", []):
            if e.get("isAllDay") or e.get("isCancelled"):
                continue
            out.append(
                CalendarEvent(
                    id=f"microsoft:{e['id']}",
                    source="microsoft",
                    title=e.get("subject") or "(no title)",
                    start=_parse(e["start"]["dateTime"]),
                    end=_parse(e["end"]["dateTime"]),
                    attendees=len(e.get("attendees", [])),
                    description=(e.get("bodyPreview") or "")[:2000],
                    join_url=(e.get("onlineMeeting") or {}).get("joinUrl"),
                )
            )
        return out
