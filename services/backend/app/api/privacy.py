"""Privacy: settings, the providers list with their data policy, consent events, deleting a
meeting, exporting and deleting your account."""

from __future__ import annotations

import os
from typing import Literal
from urllib.parse import urlparse

from fastapi import APIRouter, Response, status
from pydantic import BaseModel, Field

from app.api.meetings import _owned, _readable
from app.auth import CurrentUser
from app.meetings.store import ConsentEvent
from app.privacy.service import delete_account, delete_meeting, export_account
from app.privacy.store import PrivacySettings
from app.router.config import is_loopback_url
from app.services import services

router = APIRouter()


@router.get("/me/privacy", response_model=PrivacySettings)
async def get_privacy(user: CurrentUser) -> PrivacySettings:
    return await services().privacy.get(user.user_id)


@router.put("/me/privacy", response_model=PrivacySettings)
async def put_privacy(body: PrivacySettings, user: CurrentUser) -> PrivacySettings:
    return await services().privacy.put(user.user_id, body)


class ProviderOut(BaseModel):
    name: str
    kind: str
    trains_on_data: bool | Literal["unknown"]
    local: bool
    #: Tasks whose fallback chain uses this provider.
    tasks: list[str]
    #: Whether meeting data may reach it for you right now.
    meeting_data_allowed: bool


@router.get("/providers", response_model=list[ProviderOut])
async def list_providers(user: CurrentUser) -> list[ProviderOut]:
    s = services()
    opt_in = (await s.privacy.get(user.user_id)).allow_test_providers
    out = []
    for name, p in s.config.providers.items():
        tasks = sorted(
            t for t, chain in s.config.tasks.items() if any(d.provider == name for d in chain)
        )
        out.append(
            ProviderOut(
                name=name,
                kind=p.kind,
                trains_on_data=p.trains_on_data,
                local=p.local,
                tasks=tasks,
                meeting_data_allowed=p.trains_on_data is False or opt_in,
            )
        )
    return out


def local_mode_problem() -> str | None:
    """Local-only meetings need a backend whose database is on this machine too."""
    dsn = os.environ.get("DATABASE_URL", "")
    if dsn:
        host = urlparse(dsn).hostname or ""
        if not is_loopback_url(f"http://{host}"):
            return (
                "Local-only needs the backend's database on this computer (DATABASE_URL is remote)."
            )
    return None


class ConsentIn(BaseModel):
    kind: Literal["announced", "objection"]
    note: str | None = Field(default=None, max_length=1000)


class ConsentOut(BaseModel):
    kind: str
    note: str | None
    at: float


@router.post("/meetings/{meeting_id}/consent", status_code=status.HTTP_201_CREATED)
async def add_consent(meeting_id: str, body: ConsentIn, user: CurrentUser) -> dict[str, bool]:
    """Log that you announced the recording (or that someone objected)."""
    m = await _owned(meeting_id, user.user_id)
    if m.mode == "live-only":
        return {"logged": False}  # Live-only keeps nothing
    await services().meetings.add_consent_event(ConsentEvent(m.id, body.kind, body.note))
    return {"logged": True}


@router.get("/meetings/{meeting_id}/consent", response_model=list[ConsentOut])
async def list_consent(meeting_id: str, user: CurrentUser) -> list[ConsentOut]:
    m = await _readable(meeting_id, user.user_id)
    return [
        ConsentOut(kind=e.kind, note=e.note, at=e.at)
        for e in await services().meetings.consent_events(m.id)
    ]


@router.delete("/meetings/{meeting_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_meeting(meeting_id: str, user: CurrentUser) -> None:
    """Delete everything for a meeting (owner only)."""
    m = await _owned(meeting_id, user.user_id)
    await delete_meeting(services(), m.id)


@router.get("/me/export")
async def export(user: CurrentUser) -> Response:
    data = await export_account(services(), user.user_id)
    return Response(
        data,
        media_type="application/zip",
        headers={"Content-Disposition": 'attachment; filename="meeting-copilot-export.zip"'},
    )


class DeleteAccount(BaseModel):
    #: Typed by the user, so a stray request can't delete an account.
    confirm: Literal["delete my account"]


@router.post("/me/delete", status_code=status.HTTP_204_NO_CONTENT)
async def remove_account(body: DeleteAccount, user: CurrentUser) -> None:
    await delete_account(services(), user.user_id)
