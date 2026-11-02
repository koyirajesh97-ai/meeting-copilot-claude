"""Split transcripts and summaries into search chunks (~400 tokens, 50 overlap), keeping each
line's speaker and timestamp so answers can cite the moment something was said."""

from __future__ import annotations

from dataclasses import dataclass

from app.meetings.store import Segment
from app.summaries.pipeline import transcript_lines
from app.summaries.schema import Summary

CHARS_PER_TOKEN = 4
CHUNK_TOKENS = 400
OVERLAP_TOKENS = 50


@dataclass
class Chunk:
    source_type: str  # transcript | summary
    source_id: str  # first segment id, or the summary part
    text: str
    start_ms: int | None


def transcript_chunks(segments: list[Segment], names: dict[str, str]) -> list[Chunk]:
    lines = transcript_lines(segments, names)
    limit, overlap = CHUNK_TOKENS * CHARS_PER_TOKEN, OVERLAP_TOKENS * CHARS_PER_TOKEN
    chunks: list[Chunk] = []
    i = 0
    while i < len(lines):
        size, j = 0, i
        while j < len(lines) and (j == i or size + len(lines[j]) <= limit):
            size += len(lines[j]) + 1
            j += 1
        chunks.append(
            Chunk("transcript", segments[i].segment_id, "\n".join(lines[i:j]), segments[i].start_ms)
        )
        if j >= len(lines):
            break
        # Overlap: repeat the chunk's last line (always), plus earlier lines up to ~50 tokens,
        # so an idea spanning the cut stays findable. A one-line chunk can't overlap.
        k = j - 1 if j - 1 > i else j
        back = len(lines[k]) + 1 if k < j else 0
        while k - 1 > i and back + len(lines[k - 1]) <= overlap:
            k -= 1
            back += len(lines[k]) + 1
        i = k
    return chunks


def summary_chunks(summary: Summary) -> list[Chunk]:
    parts: list[tuple[str, str]] = []
    if summary.overview:
        parts.append(("overview", f"Overview: {summary.overview}"))
    for s in summary.sections:
        if s.items:
            parts.append((s.key, f"{s.title}: " + "; ".join(s.items)))
    if summary.decisions:
        parts.append(("decisions", "Decisions: " + "; ".join(d.text for d in summary.decisions)))
    if summary.action_items:
        parts.append(
            (
                "action_items",
                "Action items: "
                + "; ".join(
                    a.text + (f" (owner {a.owner})" if a.owner else "")
                    for a in summary.action_items
                ),
            )
        )
    for p in summary.per_person:
        parts.append(
            (
                f"person:{p.person}",
                f"{p.person}: done {'; '.join(p.done)}; doing {'; '.join(p.doing)}; blockers {'; '.join(p.blockers)}",
            )
        )
    if summary.open_questions:
        parts.append(("open_questions", "Open questions: " + "; ".join(summary.open_questions)))
    return [Chunk("summary", key, text, None) for key, text in parts]
