"""What the summary prompts must return. Validated with pydantic; invalid output is retried."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field, field_validator


class _M(BaseModel):
    model_config = ConfigDict(extra="ignore")


class ActionItem(_M):
    owner: str | None = None
    text: str = Field(min_length=1)
    #: As said ("Friday", "2026-11-06"); null unless someone said it.
    due_date: str | None = None

    @field_validator("owner", "due_date", mode="before")
    @classmethod
    def _blank_is_null(cls, v: object) -> object:
        return (
            None
            if isinstance(v, str) and v.strip().lower() in {"", "null", "none", "n/a", "unknown"}
            else v
        )


class Decision(_M):
    text: str = Field(min_length=1)
    rationale: str = ""


class PersonUpdate(_M):
    person: str
    done: list[str] = []
    doing: list[str] = []
    blockers: list[str] = []


class MapExtract(_M):
    decisions: list[Decision] = []
    action_items: list[ActionItem] = []
    blockers: list[str] = []
    open_questions: list[str] = []
    key_points: list[str] = []
    per_person: list[PersonUpdate] = []


class SummarySection(_M):
    key: str
    title: str
    items: list[str] = []


class Summary(_M):
    overview: str = ""
    sections: list[SummarySection] = []
    decisions: list[Decision] = []
    takeaways: list[str] = []
    action_items: list[ActionItem] = []
    blockers: list[str] = []
    open_questions: list[str] = []
    per_person: list[PersonUpdate] = []
