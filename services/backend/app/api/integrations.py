"""Integrations: settings, calendar OAuth, upcoming meetings, Jira tickets, posting summaries."""

from __future__ import annotations

import time
from typing import Literal

from fastapi import APIRouter, HTTPException, Request, status
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field

from app.api.meetings import _readable
from app.auth import CurrentUser, InvalidToken, issue_token, verify_token
from app.integrations.base import CALENDARS, KINDS, POSTERS, IntegrationError, Kind
from app.integrations.calendars import authorize_url, client_creds, exchange_code
from app.integrations.store import Integration
from app.integrations.webhooks import check_webhook
from app.services import services
from app.summaries.markdown import meeting_markdown
from app.summaries.schema import Summary

router = APIRouter()

LABEL = {
    "google": "Google Calendar",
    "microsoft": "Outlook / Microsoft 365",
    "jira": "Jira",
    "slack": "Slack",
    "teams": "Microsoft Teams",
}


class IntegrationOut(BaseModel):
    kind: Kind
    label: str
    enabled: bool
    connected: bool
    #: Non-secret settings (Jira site and email). Secrets are never returned.
    config: dict
    last_error: str | None
    #: Calendars need the backend's OAuth client (or Fake mode).
    available: bool


def _available(kind: Kind) -> bool:
    return kind not in CALENDARS or services().integrations.fake or client_creds(kind) is not None


def _out(kind: Kind, i: Integration | None) -> IntegrationOut:
    fake = services().integrations.fake
    return IntegrationOut(
        kind=kind,
        label=LABEL[kind],
        enabled=bool(i and i.enabled),
        connected=bool(i and (i.secret or fake)),
        config=i.config if i else {},
        last_error=i.last_error if i else None,
        available=_available(kind),
    )


def _kind(kind: str) -> Kind:
    if kind not in KINDS:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown integration")
    return kind  # type: ignore[return-value]


@router.get("/integrations", response_model=list[IntegrationOut])
async def list_integrations(user: CurrentUser) -> list[IntegrationOut]:
    mine = {i.kind: i for i in await services().integrations.store.for_user(user.user_id)}
    return [_out(k, mine.get(k)) for k in KINDS]


class IntegrationIn(BaseModel):
    enabled: bool = True
    #: Jira: the site (https://team.atlassian.net) and your Atlassian email.
    site: str | None = Field(default=None, max_length=300)
    email: str | None = Field(default=None, max_length=300)
    #: Secrets: the Jira API token, or the Slack/Teams webhook URL. Omit to keep the stored one.
    api_token: str | None = Field(default=None, max_length=500)
    webhook_url: str | None = Field(default=None, max_length=2000)


@router.put("/integrations/{kind}", response_model=IntegrationOut)
async def put_integration(kind: str, body: IntegrationIn, user: CurrentUser) -> IntegrationOut:
    k = _kind(kind)
    svc = services().integrations
    i = await svc.store.get(user.user_id, k) or Integration(user.user_id, k)
    i.enabled, i.last_error = body.enabled, None
    try:
        if k == "jira":
            i.config = {
                "site": (body.site or i.config.get("site", "")).rstrip("/"),
                "email": body.email or i.config.get("email", ""),
            }
            if body.api_token:
                i.secret = {"api_token": body.api_token}
            if i.enabled:
                if not i.config["site"] or not i.config["email"] or not i.secret.get("api_token"):
                    raise IntegrationError("Jira needs the site, your email and an API token.")
                # Test the token now, so Settings can say whether it works.
                await svc.factory("jira").updated_since(
                    {**i.config, **i.secret}, time.time() - 86400
                )
        elif k in POSTERS:
            if body.webhook_url:
                i.secret = {"webhook_url": check_webhook(k, body.webhook_url)}
            if i.enabled and not i.secret.get("webhook_url"):
                raise IntegrationError(f"Add the {LABEL[k]} incoming webhook URL.")
        elif k in CALENDARS and svc.fake and i.enabled and not i.secret:
            i.secret = {"fake": True}  # Fake mode connects without OAuth
    except IntegrationError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from e
    await svc.store.put(i)
    svc.forget(user.user_id)
    return _out(k, i)


@router.delete("/integrations/{kind}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_integration(kind: str, user: CurrentUser) -> None:
    await services().integrations.store.delete(user.user_id, _kind(kind))
    services().integrations.forget(user.user_id)


# ---------- calendar OAuth ----------


def _redirect_uri(request: Request) -> str:
    return str(request.url_for("oauth_callback"))


@router.post("/integrations/{kind}/connect")
async def connect(kind: str, request: Request, user: CurrentUser) -> dict[str, str]:
    """The URL to open in the browser to let us read your calendar."""
    k = _kind(kind)
    if k not in CALENDARS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Only calendars connect by signing in")
    state = issue_token(user.user_id, scope="oauth", meeting_id=k, ttl_s=600)
    try:
        return {"authorize_url": authorize_url(k, _redirect_uri(request), state)}
    except IntegrationError as e:
        raise HTTPException(status.HTTP_409_CONFLICT, str(e)) from e


PAGE = """<!doctype html><meta charset="utf-8"><title>Meeting Copilot</title>
<body style="font-family:system-ui;max-width:32rem;margin:4rem auto;line-height:1.5"><h1>{title}</h1><p>{body}</p></body>"""


@router.get("/integrations/oauth/callback", name="oauth_callback", response_class=HTMLResponse)
async def oauth_callback(
    request: Request, state: str = "", code: str = "", error: str = ""
) -> HTMLResponse:
    try:
        p = verify_token(state, scope="oauth")
    except InvalidToken:
        return HTMLResponse(
            PAGE.format(title="Link expired", body="Start again from Settings in the app."), 400
        )
    k: Kind = p.meeting_id  # type: ignore[assignment]
    if error or not code:
        return HTMLResponse(
            PAGE.format(
                title="Not connected", body=f"{LABEL[k]} wasn't connected ({error or 'cancelled'})."
            ),
            400,
        )
    svc = services().integrations
    try:
        secret = await exchange_code(
            k, code, _redirect_uri(request), getattr(svc, "transport", None)
        )
    except IntegrationError as e:
        return HTMLResponse(PAGE.format(title="Not connected", body=str(e)), 400)
    await svc.store.put(Integration(p.user_id, k, True, {}, secret))
    svc.forget(p.user_id)
    return HTMLResponse(
        PAGE.format(
            title=f"{LABEL[k]} connected",
            body="You can close this window and go back to Meeting Copilot.",
        )
    )


# ---------- upcoming meetings ----------


class UpcomingOut(BaseModel):
    id: str
    source: str
    title: str
    start: float
    end: float
    attendees: int
    guessed_type: str
    agenda: str
    join_url: str | None
    #: The meeting already started from this event, if any.
    meeting_id: str | None


@router.get("/calendar/upcoming", response_model=list[UpcomingOut])
async def upcoming(user: CurrentUser, hours: float = 12) -> list[UpcomingOut]:
    s = services()
    events = await s.integrations.upcoming(user.user_id, hours=min(max(hours, 1), 48))
    started = {
        m.calendar_event_id: m.id
        for m in await s.meetings.list_for(user.user_id, 50)
        if m.calendar_event_id
    }
    return [
        UpcomingOut(
            id=e.id,
            source=e.source,
            title=e.title,
            start=e.start,
            end=e.end,
            attendees=e.attendees,
            guessed_type=s.integrations.guess(e),
            agenda=e.description,
            join_url=e.join_url,
            meeting_id=started.get(e.id),
        )
        for e in events
        if e.end > time.time()
    ]


# ---------- Jira tickets for standup prep ----------


class TicketOut(BaseModel):
    key: str
    summary: str
    status: str
    updated: float
    url: str | None


async def tickets_for_standup(user_id: str) -> list[TicketOut]:
    """Your tickets updated since the day of your last standup (at most a week back)."""
    from app.standup.service import today

    s = services()
    prev = await s.standups.previous(user_id, None, today())
    week = time.time() - 7 * 86400
    since = max(week, time.mktime(prev.day.timetuple())) if prev else time.time() - 86400
    return [TicketOut(**t.__dict__) for t in await s.integrations.tickets_since(user_id, since)]


@router.get("/standup/tickets", response_model=list[TicketOut])
async def standup_tickets(user: CurrentUser) -> list[TicketOut]:
    return await tickets_for_standup(user.user_id)


# ---------- post a summary to Slack or Teams ----------


class ShareIn(BaseModel):
    target: Literal["slack", "teams"]


class SharePreview(BaseModel):
    target: str
    text: str
    #: Required to post: proves the user saw this preview (valid 15 minutes).
    preview_token: str


class SharePost(BaseModel):
    target: Literal["slack", "teams"]
    text: str = Field(min_length=1, max_length=20_000)
    preview_token: str


@router.post("/meetings/{meeting_id}/share/preview", response_model=SharePreview)
async def share_preview(meeting_id: str, body: ShareIn, user: CurrentUser) -> SharePreview:
    m = await _readable(meeting_id, user.user_id)
    s = services()
    stored = await s.meetings.latest_summary(m.id)
    if stored is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "This meeting has no summary yet")
    text = meeting_markdown(
        m,
        Summary.model_validate(stored.sections),
        await s.meetings.action_items(m.id),
        [],
        {},
        include_transcript=False,
    )
    token = issue_token(user.user_id, scope="share", meeting_id=f"{m.id}:{body.target}", ttl_s=900)
    return SharePreview(target=body.target, text=text, preview_token=token)


@router.post("/meetings/{meeting_id}/share", status_code=status.HTTP_204_NO_CONTENT)
async def share(meeting_id: str, body: SharePost, user: CurrentUser) -> None:
    """Posts exactly the (possibly edited) text the user confirmed in the preview."""
    m = await _readable(meeting_id, user.user_id)
    try:
        p = verify_token(body.preview_token, scope="share", meeting_id=f"{m.id}:{body.target}")
    except InvalidToken as e:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "Preview the post first (or again, if it's been a while)"
        ) from e
    if p.user_id != user.user_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Preview the post first")
    try:
        await services().integrations.post(user.user_id, body.target, body.text)
    except IntegrationError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from e
