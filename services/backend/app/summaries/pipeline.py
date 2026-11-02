"""Map/reduce summary: transcript chunks under ~6K tokens -> extracts -> one summary."""

from __future__ import annotations

import asyncio
import json
import re
import time
from dataclasses import dataclass

from app.meetings.store import Segment
from app.metrics import metrics
from app.prompts import load
from app.router.policy import DataClass
from app.router.router import Router

from .schema import MapExtract, Summary, SummarySection
from .templates import Template, describe_sections

#: Groq allows 8K tokens/minute per model, so each map call stays well under that.
MAX_CHUNK_TOKENS = 5000
CHARS_PER_TOKEN = 4
MAP_CONCURRENCY = 2


def clock(ms: int) -> str:
    s = ms // 1000
    return (
        f"{s // 3600}:{s // 60 % 60:02d}:{s % 60:02d}"
        if s >= 3600
        else f"{s // 60:02d}:{s % 60:02d}"
    )


def transcript_lines(segments: list[Segment], names: dict[str, str]) -> list[str]:
    def who(sid: str) -> str:
        if sid in names:
            return names[sid]
        if sid == "me":
            return "Me"
        m = re.fullmatch(r"spk_(\d+)", sid)
        return f"Speaker {int(m.group(1)) + 1}" if m else sid

    return [f"[{clock(s.start_ms)}] {who(s.speaker_id)}: {s.text}" for s in segments]


def chunk_lines(lines: list[str], max_tokens: int = MAX_CHUNK_TOKENS) -> list[str]:
    limit = max_tokens * CHARS_PER_TOKEN
    chunks: list[str] = []
    cur: list[str] = []
    size = 0
    for line in lines:
        if cur and size + len(line) + 1 > limit:
            chunks.append("\n".join(cur))
            cur, size = [], 0
        cur.append(line[:limit])
        size += len(line) + 1
    if cur:
        chunks.append("\n".join(cur))
    return chunks


def _mentioned(value: str, transcript: str) -> bool:
    return value.lower() in transcript.lower()


def ground(summary: Summary, transcript: str) -> Summary:
    """Owners and due dates stay null unless they were actually said."""
    for item in summary.action_items:
        if (
            item.owner
            and not _mentioned(item.owner, transcript)
            and item.owner.lower() not in {"me", "you"}
        ):
            item.owner = None
        if item.due_date and not _mentioned(item.due_date, transcript):
            item.due_date = None
    return summary


@dataclass
class SummaryResult:
    summary: Summary
    provider: str
    chunks: int
    latency_ms: int


async def summarize(
    router: Router,
    meeting_type: str,
    segments: list[Segment],
    template: Template,
    names: dict[str, str] | None = None,
    data_class: DataClass = "meeting",
) -> SummaryResult:
    t0 = time.perf_counter()
    lines = transcript_lines(segments, names or {})
    if not lines:
        return SummaryResult(
            Summary(overview="Nothing was transcribed in this meeting."), "none", 0, 0
        )
    chunks = chunk_lines(lines)
    sem = asyncio.Semaphore(MAP_CONCURRENCY)
    map_prompt, reduce_prompt = load("summary_map"), load("summary_reduce")

    async def run_map(chunk: str) -> MapExtract:
        async with sem:
            out = await router.complete(
                "summary",
                map_prompt.render(meeting_type=template.label, chunk=chunk),
                data_class,
                MapExtract,
            )
            return out.json

    extracts = await asyncio.gather(*(run_map(c) for c in chunks))
    payload = json.dumps([e.model_dump() for e in extracts], ensure_ascii=False)
    out = await router.complete(
        "summary",
        reduce_prompt.render(
            meeting_type=template.label,
            template_sections=describe_sections(template),
            extracts=payload,
        ),
        data_class,
        Summary,
    )
    summary: Summary = out.json
    # Keep exactly the template's sections, in order, even if the model skipped or renamed one.
    got = {s.key: s for s in summary.sections}
    summary.sections = [
        SummarySection(key=s.key, title=s.title, items=got[s.key].items if s.key in got else [])
        for s in template.sections
    ]
    if not template.per_person:
        summary.per_person = []
    summary = ground(summary, "\n".join(lines))
    latency = int((time.perf_counter() - t0) * 1000)
    metrics.record("summary.total_ms", latency, out.provider)
    return SummaryResult(summary, out.provider, len(chunks), latency)
