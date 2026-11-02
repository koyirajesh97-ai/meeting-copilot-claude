"""Deleting and exporting your data, and the retention job."""

from __future__ import annotations

import asyncio
import contextlib
import io
import json
import logging
import time
import zipfile
from dataclasses import asdict
from datetime import UTC, datetime

from app.meetings.store import Meeting
from app.summaries.markdown import meeting_markdown
from app.summaries.schema import Summary

log = logging.getLogger("app.privacy")

RETENTION_EVERY_S = 3600


async def delete_meeting(s, meeting_id: str) -> None:
    """Remove a meeting and everything derived from it: transcript, search chunks, summaries,
    cards, action items, decisions, speaker names and consent events. (Audio never reaches the
    backend; the desktop app deletes its local WAV files.)"""
    await s.sessions.end(meeting_id, mark_ended=False)
    s.sessions.forget(meeting_id)
    await s.search.index.delete_meeting(meeting_id)
    drop = getattr(s.cards, "delete_for_meeting", None)
    if drop:
        await drop(meeting_id)
    await s.meetings.delete_meeting(meeting_id)


async def _delete_document(s, d) -> None:
    await s.search.index.delete_document(d.id)
    if d.storage_path:
        await s.blobs.delete(d.storage_path)
    await s.documents.delete(d.id)


async def delete_account(s, user_id: str) -> None:
    """Your meetings, voiceprints, profile, standups, documents you uploaded and memberships.
    Projects where you're the only member are deleted; where you're the only owner, the next
    member becomes owner, so the team keeps its project."""
    for m in await s.meetings.list_for(user_id, limit=100_000):
        await delete_meeting(s, m.id)
    for sp in await s.speakers.mine(user_id):
        await s.speakers.delete(sp.id, user_id)
    for p, role in await s.projects.for_user(user_id):
        members = [m for m in await s.projects.member_list(p.id) if m.user_id != user_id]
        if not members:
            for d in await s.documents.for_project(p.id):
                await _delete_document(s, d)
            await s.meetings.detach_project(p.id)
            await s.projects.delete(p.id)
            continue
        for d in await s.documents.for_project(p.id):
            if d.uploaded_by == user_id:
                await _delete_document(s, d)
        if role == "owner" and not any(m.role == "owner" for m in members):
            heir = next((m for m in members if m.role == "member"), members[0])
            await s.projects.set_member(p.id, heir.user_id, "owner")
        await s.projects.remove_member(p.id, user_id)
    for store in (s.profiles, s.standups):
        rows = getattr(store, "rows", None)
        if isinstance(rows, dict):  # in memory; Postgres rows cascade from the user
            for k in [
                k for k in rows if k == user_id or (isinstance(k, tuple) and k[0] == user_id)
            ]:
                del rows[k]
    users = getattr(s.projects, "users", None)
    if isinstance(users, dict):
        users.pop(user_id, None)
    await s.privacy.delete_user(user_id)
    log.info("deleted account %s", user_id)


def _jsonable(o):
    if isinstance(o, float) and o > 1e9:
        return datetime.fromtimestamp(o, UTC).isoformat()
    return o


def _slug(m: Meeting) -> str:
    day = datetime.fromtimestamp(m.started_at, UTC).strftime("%Y-%m-%d")
    safe = "".join(c if c.isalnum() else "-" for c in m.title.lower()).strip("-")[:40] or "meeting"
    return f"{day}-{safe}-{m.id[:8]}"


async def export_account(s, user_id: str) -> bytes:
    """A zip: one Markdown and one JSON file per meeting you recorded, plus your profile,
    privacy settings and enrolled voices (names only; never a voiceprint)."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        meetings = await s.meetings.list_for(user_id, limit=100_000)
        for m in meetings:
            st = s.meetings
            summary = await st.latest_summary(m.id)
            items = await st.action_items(m.id)
            segments = await st.segments(m.id)
            names = await st.speaker_names(m.id)
            z.writestr(
                f"meetings/{_slug(m)}.md",
                meeting_markdown(
                    m,
                    Summary.model_validate(summary.sections) if summary else None,
                    items,
                    segments,
                    names,
                ),
            )
            data = {
                "meeting": {k: _jsonable(v) for k, v in asdict(m).items()},
                "summary": summary.sections if summary else None,
                "action_items": [asdict(i) for i in items],
                "decisions": [asdict(d) for d in await st.decisions(m.id)],
                "transcript": [asdict(x) for x in segments],
                "speaker_names": names,
                "consent_events": [asdict(e) for e in await st.consent_events(m.id)],
            }
            z.writestr(f"meetings/{_slug(m)}.json", json.dumps(data, indent=2, default=str))
        profile = await s.profiles.get(user_id)
        z.writestr(
            "account.json",
            json.dumps(
                {
                    "user_id": user_id,
                    "exported_at": datetime.now(UTC).isoformat(),
                    "profile": profile.model_dump() if profile else None,
                    "privacy": (await s.privacy.get(user_id)).model_dump(),
                    "enrolled_voices": [
                        {"id": v.id, "name": v.display_name, "project_id": v.project_id}
                        for v in await s.speakers.mine(user_id)
                    ],
                    "projects": [
                        {"id": p.id, "name": p.name, "role": r}
                        for p, r in await s.projects.for_user(user_id)
                    ],
                    "meetings": len(meetings),
                },
                indent=2,
            ),
        )
        z.writestr(
            "README.md",
            "# Your Meeting Copilot export\n\nOne Markdown file (summary, action items, transcript) and "
            "one JSON file (everything, machine-readable) per meeting you recorded. Audio stays on "
            "your computer and isn't included.\n",
        )
    return buf.getvalue()


async def sweep_retention(s, now: float | None = None) -> int:
    """Delete meetings past their owner's retention period (and abandoned Live-only meetings)."""
    expired = await s.meetings.expired_meetings(now or time.time())
    for m in expired:
        if s.sessions.get(m.id) and m.mode != "live-only":
            continue  # never delete a meeting that's being recorded right now
        await delete_meeting(s, m.id)
    if expired:
        log.info("retention: deleted %d meeting(s)", len(expired))
    return len(expired)


async def retention_loop(get_services, every_s: float = RETENTION_EVERY_S) -> None:
    while True:
        with contextlib.suppress(Exception):
            await sweep_retention(get_services())
        await asyncio.sleep(every_s)
