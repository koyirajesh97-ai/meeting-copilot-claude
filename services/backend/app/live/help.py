"""Live help during a meeting: detect questions aimed at the user and answer them with cards
grounded only in project data and the meeting so far.

For each final line someone else says:
  1. Cheap rules: does it look like a question? (question word, "?", "can you"...)
  2. If so, start retrieval for it right away (pre-warm) and, in parallel, ask the fast `detect`
     model whether it's a question and whether it's addressed to the user.
  3. If it's addressed to the user, ask the `card` model for at most 3 bullets using ONLY the
     retrieved excerpts, today's standup notes and the last few minutes. The first bullet goes
     out as card.created, the rest as card.delta. Empty or low-confidence answers become a
     "No grounded answer" card that offers I'll follow up.
Every card is saved (suggestions) with its sources, provider and later Used / Not useful.
"""

from __future__ import annotations

import asyncio
import logging
import re
import time
from dataclasses import dataclass, field
from typing import Any

from pydantic import BaseModel, Field

from app.events import (
    CardCreated,
    CardDelta,
    Control,
    Error,
    ProviderSwitched,
    QuestionDetected,
    QuotaWarning,
)
from app.meetings.store import ActionItemRecord, Segment, new_id
from app.metrics import metrics
from app.profiles.store import RoleProfile
from app.prompts import load
from app.realtime.session import MeetingSession, Peer, Plugin
from app.router.config import LiveHelpConfig
from app.router.router import (
    NoProviderAvailable,
    Router,
)
from app.router.router import (
    ProviderSwitched as RouterSwitched,
)
from app.router.router import (
    QuotaWarning as RouterQuota,
)
from app.search.index import Hit
from app.search.service import SearchService
from app.summaries.pipeline import clock, transcript_lines

from .store import CardRecord, new_card_id

log = logging.getLogger("app.live")

QUESTION_START = re.compile(
    r"^(what|when|where|who|whom|whose|why|how|which|can|could|would|will|should|shall|is|are|was|were|do|does|did|have|has|any)\b",
    re.I,
)
QUESTION_ANYWHERE = re.compile(
    r"\b(can you|could you|would you|do you know|any update|what about|how about)\b", re.I
)
#: Don't re-check the same system or ticket more often than this when nothing was found.
TOPIC_RETRY_S = 15
NO_ANSWER = "No grounded answer in your project notes. Tap I'll follow up."


def looks_like_question(text: str) -> bool:
    t = text.strip()
    return t.endswith("?") or bool(QUESTION_START.match(t)) or bool(QUESTION_ANYWHERE.search(t))


TURN_PATTERNS = [
    r"(?:over to|next(?: up)?(?: is)?|your turn,?|what about you,?|how about you,?|and you,?|go ahead,?)\s+{name}\b",
    r"^\s*{name}\s*(?:,|\?|$|you're up|go ahead|your turn|you next|what about you)",
    r"\b{name}\s*,?\s*(?:go ahead|you're up|your turn|you're next|want to go)",
]


def is_my_turn(text: str, names: list[str]) -> bool:
    """Someone handed the standup to you: "over to Sai", "Sai, go ahead", "Sai?"..."""
    for n in names:
        name = re.escape(n)
        if any(re.search(p.format(name=name), text, re.I) for p in TURN_PATTERNS):
            return True
    return False


def mentions(text: str, terms: list[str]) -> bool:
    low = text.lower()
    return any(t and re.search(rf"(?<!\w){re.escape(t.lower())}(?!\w)", low) for t in terms)


class DetectOut(BaseModel):
    is_question: bool = False
    addressed_to_me: bool = False
    topic: str = Field(default="", max_length=120)


class Bullet(BaseModel):
    text: str = Field(min_length=1)
    source: str = ""


class CardOut(BaseModel):
    bullets: list[Bullet] = []
    confidence: float = Field(default=0, ge=0, le=1)


class CatchUpOut(BaseModel):
    bullets: list[str] = []


class Term(BaseModel):
    term: str
    meaning: str = ""


class ClarifyOut(BaseModel):
    plain: str = ""
    terms: list[Term] = []


@dataclass
class DetectedQuestion:
    segment: Segment
    topic: str
    addressed_to_me: bool
    answered: bool = False
    card_id: str | None = None
    followed_up: bool = False


@dataclass
class Context:
    """The numbered context for an answer card, and how to cite each entry."""

    lines: list[str] = field(default_factory=list)
    sources: dict[str, dict[str, Any]] = field(default_factory=dict)

    def add(self, text: str, source: dict[str, Any]) -> None:
        sid = f"s{len(self.lines) + 1}"
        self.lines.append(f"[{sid}] {' '.join(text.split())}")
        self.sources[sid] = source

    def render(self) -> str:
        return "\n".join(self.lines) or "(nothing)"


class LiveHelp(Plugin):
    def __init__(
        self,
        session: MeetingSession,
        router: Router,
        search: SearchService,
        cards,
        profile: RoleProfile,
        cfg: LiveHelpConfig,
        standup_notes: str = "",
        standup_entry=None,
    ) -> None:
        self.session = session
        self.router = router
        self.search = search
        self.cards = cards
        self.profile = profile
        self.cfg = cfg
        self.standup_notes = standup_notes
        #: Today's standup entry (standup meetings only); its script card shows on your turn.
        self.standup_entry = standup_entry
        self._script_shown = False
        self.questions: list[DetectedQuestion] = []
        self._last_topic = -1e9
        self._topics_shown: set[str] = set()
        self._topic_tried: dict[str, float] = {}
        self._tasks: set[asyncio.Task] = set()

    # ---------- plumbing ----------

    def _spawn(self, coro) -> None:
        t = asyncio.create_task(coro)
        self._tasks.add(t)
        t.add_done_callback(self._tasks.discard)

    async def _notice(self, n) -> None:
        """Router fallbacks and quota warnings during live help go to the overlay too."""
        if isinstance(n, RouterSwitched):
            await self.session.emit(
                ProviderSwitched, task=n.task, from_=n.from_, to=n.to, reason=n.reason
            )
        elif isinstance(n, RouterQuota):
            await self.session.emit(
                QuotaWarning,
                provider=n.provider,
                task=n.task,
                percent_used=n.percent_used,
                store=False,
            )

    async def complete(self, task: str, messages, schema):
        return await self.router.complete(task, messages, "meeting", schema, on_notice=self._notice)

    def recent_lines(self, minutes: float | None = None) -> list[str]:
        segs = self.session.recent
        if not segs:
            return []
        cutoff = segs[-1].end_ms - (minutes or self.cfg.recent_minutes) * 60_000
        names = {"me": self.profile.name or "Me"}
        return transcript_lines([s for s in segs if s.end_ms >= cutoff], names)

    async def close(self) -> None:
        if self._tasks:
            await asyncio.gather(*self._tasks, return_exceptions=True)

    # ---------- question -> card ----------

    async def on_final(
        self, segment: Segment, channel_start_ms: float, channel_end_ms: float
    ) -> None:
        # Standup: when your name is called, bring your script to the front (once).
        if (
            self.standup_entry
            and not self._script_shown
            and segment.channel == "system"
            and is_my_turn(segment.text, self.profile.names())
        ):
            self._script_shown = True
            self._spawn(self.standup_card(segment))
            return
        # Questions aimed at you come from other people: the meeting's audio.
        if segment.channel == "system" and looks_like_question(segment.text):
            self._spawn(self.handle_question(segment, time.perf_counter()))
            return
        # Not a question: maybe the discussion touched one of your systems or tickets.
        term = self._topic_term(segment.text)
        if term:
            self._spawn(self.topic_card(term, segment))

    async def handle_question(self, segment: Segment, t0: float) -> None:
        p = self.profile
        # Pre-warm: retrieval runs while the detector decides.
        retrieval = asyncio.create_task(self._retrieve(segment.text))
        prior = transcript_lines(self.session.recent[-4:-1], {"me": p.name or "Me"})
        try:
            det = await self.complete(
                "detect",
                load("question_detector").render(
                    name=p.name or "the user",
                    aliases=", ".join(p.aliases) or "none",
                    role_title=p.title or "team member",
                    systems_owned=", ".join(p.systems_owned) or "none",
                    tickets=", ".join(p.current_tickets) or "none",
                    last_3_utterances=" | ".join(prior) or "none",
                    speaker=segment.speaker_id,
                    text=segment.text,
                ),
                DetectOut,
            )
        except NoProviderAvailable:
            # Detection is down: fall back to rules (your name or something you own).
            det_out = DetectOut(
                is_question=True,
                addressed_to_me=mentions(segment.text, p.names() + p.systems_owned),
            )
            provider = "rules"
        else:
            det_out, provider = det.json, det.provider
        metrics.record("card.detect_ms", (time.perf_counter() - t0) * 1000, provider)
        if not det_out.is_question:
            retrieval.cancel()
            return
        q = DetectedQuestion(segment, det_out.topic, det_out.addressed_to_me)
        self.questions.append(q)
        await self.session.emit(
            QuestionDetected,
            segment_id=segment.segment_id,
            addressed_to_me=det_out.addressed_to_me,
            topic=det_out.topic or "question",
        )
        if not det_out.addressed_to_me:
            retrieval.cancel()
            return
        hits = await retrieval
        metrics.record("card.retrieve_ms", (time.perf_counter() - t0) * 1000)
        await self.answer(q, hits, t0)

    async def _retrieve(self, text: str) -> list[Hit]:
        try:
            hits = await self.search.search(
                self.session.meeting.owner_id, text, self.cfg.context_chunks + 2
            )
        except Exception:
            log.exception("retrieval failed")
            return []
        # This meeting's own lines come from the live transcript instead.
        return [h for h in hits if h.meeting_id != self.session.meeting.id][
            : self.cfg.context_chunks
        ]

    def build_context(self, hits: list[Hit]) -> Context:
        ctx = Context()
        for h in hits:
            if h.document_id:  # project knowledge (runbooks, specs)
                ctx.add(f"Document {h.text}", {"type": "document", "id": h.document_id})
                continue
            when = f" at {clock(h.start_ms)}" if h.start_ms is not None else " (summary)"
            ctx.add(
                f"{h.title}{when}: {h.text}",
                {"type": "meeting", "id": h.meeting_id, "at_ms": h.start_ms},
            )
        ctx.add(
            f"Today's standup notes: {self.standup_notes or 'none'}",
            {"type": "standup", "id": "today"},
        )
        recent = self.recent_lines()
        ctx.add(
            f"Last {self.cfg.recent_minutes:g} minutes: " + (" / ".join(recent) or "nothing yet"),
            {
                "type": "transcript",
                "id": self.session.meeting.id,
                "at_ms": self.session.recent[-1].start_ms if self.session.recent else 0,
            },
        )
        return ctx

    async def answer(self, q: DetectedQuestion, hits: list[Hit], t0: float) -> None:
        p = self.profile
        ctx = self.build_context(hits)
        try:
            out = await self.complete(
                "card",
                load("answer_card").render(
                    name=p.name or "the user",
                    role_title=p.title or "team member",
                    speaking_style=p.speaking_style or "brief",
                    question=q.segment.text,
                    context=ctx.render(),
                ),
                CardOut,
            )
        except NoProviderAvailable as e:
            await self.session.emit(
                Error, code="card_unavailable", message=str(e)[:300], retryable=True, store=False
            )
            return
        card: CardOut = out.json
        bullets = [b for b in card.bullets if b.source in ctx.sources][:3]
        card_id = new_card_id()
        q.card_id = card_id
        if not bullets or card.confidence < self.cfg.card_min_confidence:
            await self._send_card(
                card_id, "answer", [NO_ANSWER], [[]], 0.0, out.provider, q.segment.segment_id
            )
        else:
            texts = [f"- {b.text}" for b in bullets]
            sources = [[ctx.sources[b.source]] for b in bullets]
            await self._send_card(
                card_id,
                "answer",
                texts,
                sources,
                card.confidence,
                out.provider,
                q.segment.segment_id,
            )
            q.answered = True
        total = (time.perf_counter() - t0) * 1000
        metrics.record("card.total_ms", total, out.provider)
        log.info(
            "card meeting=%s question=%r provider=%s total_ms=%d",
            self.session.meeting.id,
            q.segment.text,
            out.provider,
            total,
        )

    async def _send_card(
        self,
        card_id: str,
        kind: str,
        texts: list[str],
        sources: list[list[dict]],
        confidence: float,
        provider: str,
        trigger: str | None,
    ) -> None:
        """First line as card.created right away; the rest stream in as card.delta."""
        first_sources = _dedupe(sources[0])
        await self.session.emit(
            CardCreated,
            card_id=card_id,
            kind=kind,
            text=texts[0],
            sources=first_sources,
            confidence=confidence,
            provider=provider,
        )
        seen = list(first_sources)
        for text, src in zip(texts[1:], sources[1:], strict=True):
            new = [s for s in _dedupe(src) if s not in seen]
            seen += new
            await self.session.emit(
                CardDelta, card_id=card_id, text="\n" + text, sources=new or None
            )
        await self.cards.add(
            CardRecord(
                card_id,
                self.session.meeting.id,
                kind,
                "\n".join(texts),
                seen,
                confidence,
                provider,
                trigger,
            )
        )

    # ---------- controls ----------

    async def _speaker_name(self, segment: Segment) -> str:
        """ "Priya" if named (renamed or recognized), else "Speaker 2"; "Me" for the mic."""
        names = await self.session.store.speaker_names(self.session.meeting.id)
        line = transcript_lines([segment], names)[0]
        return line.split("] ", 1)[1].split(":", 1)[0]

    async def standup_card(self, segment: Segment) -> None:
        e = self.standup_entry
        lines = (
            [e.script]
            + [f"- Done: {x}" for x in e.done]
            + [f"- Doing: {x}" for x in e.doing]
            + [f"- Blocker: {x}" for x in e.blockers]
        )
        src = {"type": "standup", "id": e.day.isoformat()}
        await self._send_card(
            new_card_id(),
            "standup",
            lines,
            [[src]] + [[] for _ in lines[1:]],
            1.0,
            "standup-prep",
            segment.segment_id,
        )

    # ---------- topic cards ----------

    def _topic_term(self, text: str) -> str | None:
        now = time.monotonic()
        if now - self._last_topic < self.cfg.topic_cooldown_s:
            return None
        for term in sorted(
            self.profile.systems_owned + self.profile.current_tickets, key=len, reverse=True
        ):
            recently_tried = now - self._topic_tried.get(term, -1e9) < TOPIC_RETRY_S
            if term not in self._topics_shown and not recently_tried and mentions(text, [term]):
                self._topic_tried[term] = now
                return term
        return None

    async def topic_card(self, term: str, segment: Segment) -> None:
        """At most one per cooldown; only if past meetings have something to say about it."""
        hits = await self._retrieve(f"{term} {segment.text}")
        if not hits:
            return
        ctx = self.build_context(hits)
        p = self.profile
        try:
            out = await self.complete(
                "card",
                load("answer_card").render(
                    name=p.name or "the user",
                    role_title=p.title or "team member",
                    speaking_style=p.speaking_style or "brief",
                    question=f'What should I remember about {term}? It just came up: "{segment.text}"',
                    context=ctx.render(),
                ),
                CardOut,
            )
        except NoProviderAvailable:
            return
        bullets = [
            b
            for b in out.json.bullets
            if b.source in ctx.sources and ctx.sources[b.source]["type"] in ("meeting", "document")
        ]
        if not bullets or out.json.confidence < self.cfg.card_min_confidence:
            return
        if time.monotonic() - self._last_topic < self.cfg.topic_cooldown_s:
            return  # another topic card got there first
        self._last_topic = time.monotonic()
        self._topics_shown.add(term)
        await self._send_card(
            new_card_id(),
            "topic",
            [f"{term}: {bullets[0].text}"] + [f"- {b.text}" for b in bullets[1:3]],
            [[ctx.sources[b.source]] for b in bullets[:3]],
            out.json.confidence,
            out.provider,
            segment.segment_id,
        )

    # ---------- overlay actions: Catch me up, Clarify, I'll follow up ----------

    async def catch_up(self, minutes: int, peer: Peer) -> None:
        t0 = time.perf_counter()
        lines = self.recent_lines(minutes)
        if not lines:
            await self._send_card(
                new_card_id(), "catch_up", ["Nothing has been said yet."], [[]], 1.0, "none", None
            )
            return
        try:
            out = await self.complete(
                "catchup",
                load("catch_up").render(
                    minutes=str(minutes),
                    name=self.profile.name or "you",
                    transcript="\n".join(lines),
                ),
                CatchUpOut,
            )
        except NoProviderAvailable as e:
            await self.session.emit(
                Error,
                code="catch_up_unavailable",
                message=str(e)[:300],
                retryable=True,
                store=False,
                only=peer,
            )
            return
        bullets = [b for b in out.json.bullets if b.strip()][:4] or ["Nothing notable was said."]
        start = self.session.recent[-1].end_ms - minutes * 60_000 if self.session.recent else 0
        src = {"type": "transcript", "id": self.session.meeting.id, "at_ms": max(0, start)}
        await self._send_card(
            new_card_id(),
            "catch_up",
            [f"Last {minutes} min: {bullets[0]}"] + [f"- {b}" for b in bullets[1:]],
            [[src]] + [[] for _ in bullets[1:]],
            1.0,
            out.provider,
            None,
        )
        metrics.record("action.catch_up_ms", (time.perf_counter() - t0) * 1000, out.provider)

    async def clarify(self, peer: Peer) -> None:
        t0 = time.perf_counter()
        last = next((s for s in reversed(self.session.recent) if s.channel == "system"), None)
        if last is None:
            await self._send_card(
                new_card_id(), "clarify", ["No one else has spoken yet."], [[]], 1.0, "none", None
            )
            return
        speaker = await self._speaker_name(last)
        vocab = ", ".join(self.session.meeting.vocabulary) or "none"
        try:
            out = await self.complete(
                "clarify",
                load("clarify").render(speaker=speaker, text=last.text, vocabulary=vocab),
                ClarifyOut,
            )
        except NoProviderAvailable as e:
            await self.session.emit(
                Error,
                code="clarify_unavailable",
                message=str(e)[:300],
                retryable=True,
                store=False,
                only=peer,
            )
            return
        c: ClarifyOut = out.json
        src = [{"type": "transcript", "id": self.session.meeting.id, "at_ms": last.start_ms}]
        lines = [f"{speaker}: {c.plain or last.text}"] + [
            f"- {t.term}: {t.meaning}" for t in c.terms[:3]
        ]
        await self._send_card(
            new_card_id(),
            "clarify",
            lines,
            [src] + [[] for _ in c.terms[:3]],
            1.0,
            out.provider,
            last.segment_id,
        )
        metrics.record("action.clarify_ms", (time.perf_counter() - t0) * 1000, out.provider)

    async def follow_up(self, peer: Peer) -> None:
        """Turn the last question (preferably one aimed at you) into an action item; the reply is
        drafted after the meeting."""
        q = next((x for x in reversed(self.questions) if x.addressed_to_me), None) or (
            self.questions[-1] if self.questions else None
        )
        if q is None:
            last = next(
                (
                    s
                    for s in reversed(self.session.recent)
                    if s.channel == "system" and s.text.strip().endswith("?")
                ),
                None,
            )
            if last is None:
                await self._send_card(
                    new_card_id(),
                    "follow_up",
                    ["No recent question to follow up on."],
                    [[]],
                    1.0,
                    "none",
                    None,
                )
                return
            q = DetectedQuestion(last, "", True)
        if q.followed_up:
            await self._send_card(
                new_card_id(),
                "follow_up",
                [f"Already on your follow-ups: {q.segment.text}"],
                [[]],
                1.0,
                "none",
                q.segment.segment_id,
            )
            return
        q.followed_up = True
        asker = await self._speaker_name(q.segment)
        m = self.session.meeting
        if m.mode != "live-only":  # Live-only keeps nothing
            await self.session.store.add_action_item(
                m,
                ActionItemRecord(
                    new_id(),
                    m.id,
                    f"Follow up with {asker}: {q.segment.text}",
                    self.profile.name or "me",
                    source="follow_up",
                    question=q.segment.text,
                    asker=asker,
                ),
            )
        await self._send_card(
            new_card_id(),
            "follow_up",
            [
                f"Added to your follow-ups: {q.segment.text}",
                "- I'll draft a reply after the meeting for you to review.",
            ],
            [[{"type": "transcript", "id": m.id, "at_ms": q.segment.start_ms}], []],
            1.0,
            "none",
            q.segment.segment_id,
        )

    async def on_control(self, msg: Control, peer: Peer) -> bool:
        if msg.action == "catch_up":
            self._spawn(self.catch_up(5 if (msg.minutes or 2) >= 5 else 2, peer))
            return True
        if msg.action == "clarify":
            self._spawn(self.clarify(peer))
            return True
        if msg.action == "follow_up":
            self._spawn(self.follow_up(peer))
            return True
        if msg.action == "card_feedback":
            if not msg.card_id or msg.useful is None:
                await self.session.emit(
                    Error,
                    code="bad_message",
                    message="card_feedback needs card_id and useful",
                    retryable=False,
                    store=False,
                    only=peer,
                )
            elif not await self.cards.feedback(self.session.meeting.id, msg.card_id, msg.useful):
                await self.session.emit(
                    Error,
                    code="unknown_card",
                    message="No such card in this meeting",
                    retryable=False,
                    store=False,
                    only=peer,
                )
            return True
        return False


def _dedupe(sources: list[dict]) -> list[dict]:
    out: list[dict] = []
    for s in sources:
        clean = {k: v for k, v in s.items() if v is not None}
        if clean not in out:
            out.append(clean)
    return out


def live_help_factory(
    router: Router, search: SearchService, cards, profiles, cfg: LiveHelpConfig, standup=None
):
    async def make(session: MeetingSession):
        m = session.meeting
        profile = await profiles.get(m.owner_id) or RoleProfile()
        notes, script = "", None
        if standup is not None:
            notes = await standup.notes_for(m.owner_id, m.project_id)
            if m.type == "standup":
                script = await standup.script_for(m.owner_id, m.project_id)
        return LiveHelp(session, router, search, cards, profile, cfg, notes, script)

    return make
