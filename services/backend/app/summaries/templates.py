"""Summary sections per meeting type (PRD "Meeting types" table).

Every summary also has the fixed parts from FR-07: overview, decisions, takeaways,
action items, blockers and open questions. `source` says which extracted list a section
draws from; prompts don't need it, but the Fake provider uses it to build sections.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Section:
    key: str
    title: str
    source: str  # decisions | action_items | blockers | open_questions | key_points


@dataclass(frozen=True)
class Template:
    id: str
    label: str
    sections: tuple[Section, ...]
    per_person: bool = False


S = Section
TEMPLATES: dict[str, Template] = {
    t.id: t
    for t in [
        Template("standup", "Standup", (), per_person=True),
        Template(
            "review",
            "Sprint, code or design review",
            (
                S("decisions", "Decisions", "decisions"),
                S("feedback", "Feedback", "key_points"),
                S("rework", "Rework items", "action_items"),
            ),
        ),
        Template(
            "planning",
            "Planning or refinement",
            (
                S("committed", "Committed items", "action_items"),
                S("owners", "Owners", "action_items"),
                S("risks", "Risks", "blockers"),
            ),
        ),
        Template(
            "incident",
            "Incident or war room",
            (
                S("timeline", "Timeline", "key_points"),
                S("root_cause", "Root cause so far", "decisions"),
                S("next_steps", "Next steps", "action_items"),
            ),
        ),
        Template(
            "client",
            "Client or business meeting",
            (
                S("commitments", "Commitments", "action_items"),
                S("asks", "Asks", "open_questions"),
                S("follow_ups", "Follow-ups", "action_items"),
            ),
        ),
        Template(
            "one_on_one",
            "One-on-one or personal",
            (
                S("agreements", "Agreements", "decisions"),
                S("feedback", "Feedback", "key_points"),
                S("follow_ups", "Follow-ups", "action_items"),
            ),
        ),
        Template(
            "research",
            "Research or learning session",
            (
                S("concepts", "Key concepts", "key_points"),
                S("questions", "Questions to dig into", "open_questions"),
            ),
        ),
        Template("custom", "Custom", (S("key_points", "Key points", "key_points"),)),
    ]
}


def template_for(meeting_type: str, override: str | None = None) -> Template:
    return TEMPLATES.get(override or meeting_type) or TEMPLATES["custom"]


def describe_sections(t: Template) -> str:
    parts = [f'"{s.key}" ({s.title})' for s in t.sections]
    if t.per_person:
        parts.append("per_person: done / doing / blockers for each person")
    return ", ".join(parts) or "none beyond the standard parts"
