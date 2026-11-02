"""Markdown export and plain-text copy of a meeting."""

from __future__ import annotations

from datetime import UTC, datetime

from app.meetings.store import ActionItemRecord, Meeting, Segment

from .pipeline import clock, transcript_lines
from .schema import Summary


def _when(t: float) -> str:
    return datetime.fromtimestamp(t, UTC).strftime("%Y-%m-%d %H:%M UTC")


def _bullets(items: list[str]) -> list[str]:
    return [f"- {i}" for i in items] or ["- None"]


def _item(a: ActionItemRecord) -> str:
    extra = ", ".join(
        x for x in [a.owner and f"owner: {a.owner}", a.due_text and f"due: {a.due_text}"] if x
    )
    done = "x" if a.status == "done" else " "
    return f"- [{done}] {a.text}" + (f" ({extra})" if extra else "")


def summary_markdown(
    meeting: Meeting, summary: Summary | None, items: list[ActionItemRecord]
) -> list[str]:
    out = []
    if summary is None:
        return ["_No summary yet._", ""]
    if summary.overview:
        out += ["## Overview", "", summary.overview, ""]
    for s in summary.sections:
        out += [f"## {s.title}", "", *_bullets(s.items), ""]
    if summary.per_person:
        out += ["## Updates", ""]
        for p in summary.per_person:
            out += [
                f"### {p.person}",
                "",
                "**Done**",
                *_bullets(p.done),
                "",
                "**Doing**",
                *_bullets(p.doing),
                "",
                "**Blockers**",
                *_bullets(p.blockers),
                "",
            ]
    out += [
        "## Decisions",
        "",
        *_bullets(
            [d.text + (f" — {d.rationale}" if d.rationale else "") for d in summary.decisions]
        ),
        "",
    ]
    out += ["## Action items", "", *([_item(a) for a in items] or ["- None"]), ""]
    if summary.takeaways:
        out += ["## Takeaways", "", *_bullets(summary.takeaways), ""]
    out += ["## Blockers", "", *_bullets(summary.blockers), ""]
    out += ["## Open questions", "", *_bullets(summary.open_questions), ""]
    return out


def meeting_markdown(
    meeting: Meeting,
    summary: Summary | None,
    items: list[ActionItemRecord],
    segments: list[Segment],
    names: dict[str, str],
    *,
    include_transcript: bool = True,
) -> str:
    out = [f"# {meeting.title}", "", f"{_when(meeting.started_at)} · {meeting.type}", ""]
    out += summary_markdown(meeting, summary, items)
    if include_transcript:
        out += ["## Transcript", ""]
        out += [f"{line}  " for line in transcript_lines(segments, names)] or ["_No transcript._"]
        out.append("")
    return "\n".join(out)


__all__ = ["clock", "meeting_markdown", "summary_markdown"]
