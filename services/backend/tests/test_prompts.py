"""Every prompt parses, renders with its fixture, and gets a valid answer through the Fake."""

import pytest

from app.prompts import all_names, load, parse
from app.router import InMemoryQuotaStore
from app.router.client import FakeClient
from app.router.fake_responses import fake_responder
from app.services import build_services

from .prompt_check import fixtures, run_all


def test_every_prompt_parses_and_renders_completely() -> None:
    fx = fixtures()
    for name in all_names():
        p = load(name)
        msgs = p.render(**fx[name]["vars"])
        text = "\n".join(m["content"] for m in msgs)
        for v in p.vars:
            assert "{" + v + "}" not in text, f"{name}: {v} left unfilled"
        assert p.version >= 1 and msgs[0]["role"] == "system"


def test_rendering_is_strict() -> None:
    p = load("clarify")
    with pytest.raises(KeyError, match="needs"):
        p.render(speaker="a", text="b")
    with pytest.raises(KeyError, match="no placeholders"):
        p.render(speaker="a", text="b", vocabulary="c", extra="d")


def test_json_braces_in_prompts_are_left_alone() -> None:
    msgs = load("answer_card").render(
        name="Sai", role_title="SRE", speaking_style="x", question="q", context="c"
    )
    assert '{"bullets": [], "confidence": 0}' in msgs[0]["content"]


def test_undeclared_placeholders_are_rejected() -> None:
    with pytest.raises(ValueError, match="not in vars"):
        parse("---\nid: x\nversion: 1\nvars: [a]\n---\nSYSTEM:\n{a} {b}\n")


async def test_every_prompt_answers_its_fixture_with_the_fake_provider() -> None:
    s = build_services(client=FakeClient(responder=fake_responder), store=InMemoryQuotaStore())
    results = await run_all(s.router)
    assert results == {name: [] for name in all_names()}
