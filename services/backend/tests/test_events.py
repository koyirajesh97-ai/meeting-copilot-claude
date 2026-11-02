"""Round-trip tests for the generated event models, using the shared examples."""

import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from app import events
from app.events import (
    EVENT_TYPES,
    CardCreated,
    ProviderSwitched,
    Source,
    dump_event,
    parse_event,
)

SCHEMA_DIR = Path(__file__).resolve().parents[3] / "packages" / "shared" / "schema"
EXAMPLES = json.loads((SCHEMA_DIR / "examples.json").read_text())
SCHEMA = json.loads((SCHEMA_DIR / "events.json").read_text())
EVENT_CLASS_NAMES = [ref["$ref"].rsplit("/", 1)[1] for ref in SCHEMA["oneOf"]]
CLASS_FOR_TYPE = {getattr(events, n).model_fields["type"].default: n for n in EVENT_CLASS_NAMES}


def test_examples_cover_every_event_type() -> None:
    assert sorted({e["type"] for e in EXAMPLES}) == sorted(EVENT_TYPES)


def test_event_types_match_schema() -> None:
    assert list(CLASS_FOR_TYPE) == list(EVENT_TYPES)


@pytest.mark.parametrize("example", EXAMPLES, ids=lambda e: f"{e['type']}#{e['seq']}")
def test_example_round_trips(example: dict) -> None:
    from_text = parse_event(json.dumps(example))
    from_dict = parse_event(example)
    assert from_text == from_dict
    assert type(from_text).__name__ == CLASS_FOR_TYPE[example["type"]]
    assert dump_event(from_text) == example


def test_prd_card_example_builds_and_serializes() -> None:
    card = CardCreated(
        seq=412,
        meeting_id="m_123",
        ts_ms=1830455123000,
        card_id="c_88",
        kind="answer",
        text="- Prod deploy moved to Thursday",
        sources=[Source(type="meeting", id="m_101", at_ms=734000)],
        confidence=0.82,
        provider="groq/gpt-oss-20b",
    )
    out = dump_event(card)
    assert out["type"] == "card.created"
    assert out["sources"] == [{"type": "meeting", "id": "m_101", "at_ms": 734000}]


def test_from_keeps_its_wire_name() -> None:
    e = ProviderSwitched(
        seq=1, meeting_id="m", ts_ms=0, task="card", from_="groq/a", to="mistral/b", reason="429"
    )
    assert dump_event(e)["from"] == "groq/a"
    assert "from_" not in dump_event(e)
    parsed = parse_event(dump_event(e))
    assert isinstance(parsed, ProviderSwitched)
    assert parsed.from_ == "groq/a"


@pytest.mark.parametrize(
    "bad",
    [
        {"type": "summary.ready", "meeting_id": "m", "ts_ms": 0, "summary_id": "s"},
        {"type": "nope", "seq": 0, "meeting_id": "m", "ts_ms": 0},
        {
            "type": "transcript.partial",
            "seq": 0,
            "meeting_id": "m",
            "ts_ms": 0,
            "channel": "phone",
            "speaker_id": "me",
            "text": "",
            "start_ms": 0,
        },
        {"type": "summary.ready", "seq": -1, "meeting_id": "m", "ts_ms": 0, "summary_id": "s"},
        {
            "type": "speaker.identified",
            "seq": 0,
            "meeting_id": "m",
            "ts_ms": 0,
            "speaker_id": "s",
            "display_name": "A",
            "confidence": 1.2,
        },
    ],
    ids=["missing-seq", "unknown-type", "bad-channel", "negative-seq", "confidence-above-1"],
)
def test_rejects_invalid_events(bad: dict) -> None:
    with pytest.raises(ValidationError):
        parse_event(bad)
