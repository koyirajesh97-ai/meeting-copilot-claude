"""Summary job: runs when a meeting ends (or on regenerate) in the background.

pending -> ready (summary, action items and decisions saved; summary.ready sent if anyone is
still connected) or failed (with the reason, so the desktop can offer Regenerate).
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable

from app.meetings.store import (
    ActionItemRecord,
    DecisionRecord,
    Meeting,
    MeetingStore,
    StoredSummary,
    new_id,
)
from app.router.router import Router
from app.summaries.pipeline import summarize
from app.summaries.schema import Summary
from app.summaries.templates import template_for

log = logging.getLogger("app.jobs.summary")

AfterReady = Callable[[Meeting, StoredSummary], Awaitable[None]]
Notify = Callable[[str, str], Awaitable[None]]  # (meeting_id, summary_id)


class SummaryJobs:
    def __init__(self, store: MeetingStore, router: Router, notify: Notify | None = None) -> None:
        self.store = store
        self.router = router
        self.notify = notify
        self.after_ready: list[AfterReady] = []
        self._tasks: dict[str, asyncio.Task] = {}

    async def enqueue(self, meeting_id: str, template: str | None = None) -> None:
        running = self._tasks.get(meeting_id)
        if running and not running.done():
            running.cancel()  # a newer request (e.g. another template) wins
        await self.store.set_summary_status(meeting_id, "pending")
        self._tasks[meeting_id] = asyncio.create_task(self._run(meeting_id, template))

    async def wait(self, meeting_id: str) -> None:
        t = self._tasks.get(meeting_id)
        if t:
            await asyncio.gather(t, return_exceptions=True)

    async def _run(self, meeting_id: str, template_id: str | None) -> None:
        meeting = await self.store.get(meeting_id)
        if meeting is None:
            return
        try:
            segments = await self.store.segments(meeting_id)
            names = await self.store.speaker_names(meeting_id)
            template = template_for(meeting.type, template_id)
            result = await summarize(
                self.router,
                meeting.type,
                segments,
                template,
                names,
                owner_id=meeting.owner_id,
                local_only=meeting.mode == "local",
            )
            stored = await self.store.save_summary(
                StoredSummary(
                    new_id(), meeting_id, template.id, result.summary.model_dump(), result.provider
                )
            )
            await self.store.replace_summary_items(meeting, *items_from(meeting, result.summary))
            await self.store.set_summary_status(meeting_id, "ready")
            log.info(
                "summary meeting=%s provider=%s chunks=%d ms=%d",
                meeting_id,
                result.provider,
                result.chunks,
                result.latency_ms,
            )
        except asyncio.CancelledError:
            raise
        except Exception as e:
            log.exception("summary failed for %s", meeting_id)
            await self.store.set_summary_status(
                meeting_id, "failed", f"{type(e).__name__}: {e}"[:500]
            )
            return
        for hook in self.after_ready:
            try:
                await hook(meeting, stored)
            except Exception:
                log.exception("after-summary hook failed for %s", meeting_id)
        if self.notify:
            await self.notify(meeting_id, stored.id)


def items_from(meeting: Meeting, s: Summary) -> tuple[list[ActionItemRecord], list[DecisionRecord]]:
    items = [
        ActionItemRecord(new_id(), meeting.id, a.text, a.owner, a.due_date, source="summary")
        for a in s.action_items
    ]
    decisions = [
        DecisionRecord(new_id(), meeting.id, d.text, d.rationale, source="summary")
        for d in s.decisions
    ]
    return items, decisions
