"""After a meeting: draft a reply for each "I'll follow up" item, using only facts found in your
meetings (prompt follow_up). Drafts are shown on Meeting detail for you to review and send."""

from __future__ import annotations

import logging

from pydantic import BaseModel

from app.meetings.store import Meeting, MeetingStore, StoredSummary
from app.profiles.store import RoleProfile
from app.prompts import load
from app.router.router import NoProviderAvailable, Router
from app.search.service import SearchService

log = logging.getLogger("app.follow_ups")


class DraftOut(BaseModel):
    draft: str = ""


def follow_up_drafter(store: MeetingStore, router: Router, search: SearchService, profiles):
    async def draft(meeting: Meeting, _summary: StoredSummary | None = None) -> int:
        items = [
            i
            for i in await store.action_items(meeting.id)
            if i.source == "follow_up" and not i.draft
        ]
        if not items:
            return 0
        profile = await profiles.get(meeting.owner_id) or RoleProfile()
        done = 0
        for item in items:
            question = item.question or item.text
            try:
                hits = await search.search(meeting.owner_id, question, 3)
            except Exception:
                hits = []
            facts = " | ".join(" ".join(h.text.split())[:400] for h in hits) or "none"
            try:
                out = await router.complete(
                    "card",
                    load("follow_up").render(
                        name=profile.name or "me",
                        question=question,
                        asker=item.asker or "a colleague",
                        facts=facts,
                    ),
                    "meeting",
                    DraftOut,
                )
            except NoProviderAvailable:
                log.warning("couldn't draft a follow-up for %s", item.id)
                continue
            if out.json.draft.strip():
                await store.set_draft(item.id, out.json.draft.strip())
                done += 1
        return done

    return draft
