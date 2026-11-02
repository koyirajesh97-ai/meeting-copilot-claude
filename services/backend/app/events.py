"""Generated from packages/shared/schema/events.json by gen-events.mjs. Do not edit.

Run `pnpm -w gen:events` after changing the schema.
"""

from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter


class _Model(BaseModel):
    model_config = ConfigDict(
        validate_by_name=True, validate_by_alias=True, serialize_by_alias=True
    )


MeetingMode = Literal["cloud", "local", "live-only"]
Channel = Literal["mic", "system"]
CardKind = Literal["answer", "topic", "clarify", "catch_up", "standup", "follow_up"]
SourceType = Literal["meeting", "document", "standup", "transcript"]


class Envelope(_Model):
    """Fields every event carries."""

    seq: int = Field(
        ge=0,
        description="Increases by one per event in a meeting; used to replay after a reconnect.",
    )
    meeting_id: str
    ts_ms: int = Field(ge=0, description="Server time in Unix milliseconds.")


class Source(_Model):
    """Where a card's fact came from."""

    type: SourceType
    id: str
    at_ms: int | None = Field(
        default=None, ge=0, description="Offset into a meeting, for meeting and transcript sources."
    )


class MeetingStarted(_Model):
    """The socket opened and the meeting is live."""

    type: Literal["meeting.started"] = Field(default="meeting.started")
    seq: int = Field(
        ge=0,
        description="Increases by one per event in a meeting; used to replay after a reconnect.",
    )
    meeting_id: str
    ts_ms: int = Field(ge=0, description="Server time in Unix milliseconds.")
    mode: MeetingMode
    providers: dict[str, str] = Field(
        description='Active provider per task, e.g. {"stt_live": "deepgram/nova-3"}.'
    )


class TranscriptPartial(_Model):
    """Interim words. Not stored."""

    type: Literal["transcript.partial"] = Field(default="transcript.partial")
    seq: int = Field(
        ge=0,
        description="Increases by one per event in a meeting; used to replay after a reconnect.",
    )
    meeting_id: str
    ts_ms: int = Field(ge=0, description="Server time in Unix milliseconds.")
    channel: Channel
    speaker_id: str
    text: str
    start_ms: int = Field(ge=0)


class TranscriptFinal(_Model):
    """A finished utterance. Stored."""

    type: Literal["transcript.final"] = Field(default="transcript.final")
    seq: int = Field(
        ge=0,
        description="Increases by one per event in a meeting; used to replay after a reconnect.",
    )
    meeting_id: str
    ts_ms: int = Field(ge=0, description="Server time in Unix milliseconds.")
    segment_id: str
    channel: Channel
    speaker_id: str
    text: str
    start_ms: int = Field(ge=0)
    end_ms: int = Field(ge=0)


class SpeakerIdentified(_Model):
    """A voice matched an enrolled person."""

    type: Literal["speaker.identified"] = Field(default="speaker.identified")
    seq: int = Field(
        ge=0,
        description="Increases by one per event in a meeting; used to replay after a reconnect.",
    )
    meeting_id: str
    ts_ms: int = Field(ge=0, description="Server time in Unix milliseconds.")
    speaker_id: str
    display_name: str
    confidence: float = Field(ge=0, le=1)


class QuestionDetected(_Model):
    """The question detector fired on a segment."""

    type: Literal["question.detected"] = Field(default="question.detected")
    seq: int = Field(
        ge=0,
        description="Increases by one per event in a meeting; used to replay after a reconnect.",
    )
    meeting_id: str
    ts_ms: int = Field(ge=0, description="Server time in Unix milliseconds.")
    segment_id: str
    addressed_to_me: bool
    topic: str


class CardCreated(_Model):
    """A card starts. Later bullets arrive as card.delta."""

    type: Literal["card.created"] = Field(default="card.created")
    seq: int = Field(
        ge=0,
        description="Increases by one per event in a meeting; used to replay after a reconnect.",
    )
    meeting_id: str
    ts_ms: int = Field(ge=0, description="Server time in Unix milliseconds.")
    card_id: str
    kind: CardKind
    text: str
    sources: list[Source]
    confidence: float = Field(ge=0, le=1)
    provider: str


class CardDelta(_Model):
    """More text for an existing card, appended to its text."""

    type: Literal["card.delta"] = Field(default="card.delta")
    seq: int = Field(
        ge=0,
        description="Increases by one per event in a meeting; used to replay after a reconnect.",
    )
    meeting_id: str
    ts_ms: int = Field(ge=0, description="Server time in Unix milliseconds.")
    card_id: str
    text: str
    sources: list[Source] | None = Field(default=None)
    confidence: float | None = Field(default=None, ge=0, le=1)


class ProviderSwitched(_Model):
    """The router fell back to another provider."""

    type: Literal["provider.switched"] = Field(default="provider.switched")
    seq: int = Field(
        ge=0,
        description="Increases by one per event in a meeting; used to replay after a reconnect.",
    )
    meeting_id: str
    ts_ms: int = Field(ge=0, description="Server time in Unix milliseconds.")
    task: str
    from_: str = Field(alias="from")
    to: str
    reason: str


class QuotaWarning(_Model):
    """A daily free quota passed 80%."""

    type: Literal["quota.warning"] = Field(default="quota.warning")
    seq: int = Field(
        ge=0,
        description="Increases by one per event in a meeting; used to replay after a reconnect.",
    )
    meeting_id: str
    ts_ms: int = Field(ge=0, description="Server time in Unix milliseconds.")
    provider: str
    task: str
    percent_used: float = Field(ge=0)


class SummaryReady(_Model):
    """The summary is saved."""

    type: Literal["summary.ready"] = Field(default="summary.ready")
    seq: int = Field(
        ge=0,
        description="Increases by one per event in a meeting; used to replay after a reconnect.",
    )
    meeting_id: str
    ts_ms: int = Field(ge=0, description="Server time in Unix milliseconds.")
    summary_id: str


class Error(_Model):
    """Something failed."""

    type: Literal["error"] = Field(default="error")
    seq: int = Field(
        ge=0,
        description="Increases by one per event in a meeting; used to replay after a reconnect.",
    )
    meeting_id: str
    ts_ms: int = Field(ge=0, description="Server time in Unix milliseconds.")
    code: str
    message: str
    retryable: bool


MeetingEvent = Annotated[
    (
        MeetingStarted
        | TranscriptPartial
        | TranscriptFinal
        | SpeakerIdentified
        | QuestionDetected
        | CardCreated
        | CardDelta
        | ProviderSwitched
        | QuotaWarning
        | SummaryReady
        | Error
    ),
    Field(discriminator="type"),
]

EVENT_TYPES: tuple[str, ...] = (
    "meeting.started",
    "transcript.partial",
    "transcript.final",
    "speaker.identified",
    "question.detected",
    "card.created",
    "card.delta",
    "provider.switched",
    "quota.warning",
    "summary.ready",
    "error",
)

_adapter: TypeAdapter[MeetingEvent] = TypeAdapter(MeetingEvent)


def parse_event(data: str | bytes | dict[str, Any]) -> MeetingEvent:
    """Parse one event from JSON text or a dict. Raises pydantic.ValidationError."""
    if isinstance(data, str | bytes):
        return _adapter.validate_json(data)
    return _adapter.validate_python(data)


def dump_event(event: MeetingEvent) -> dict[str, Any]:
    """Serialize an event to a JSON-ready dict, omitting unset optional fields."""
    return event.model_dump(mode="json", exclude_none=True)
