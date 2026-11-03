"""The eval runner's scoring and regression rules (the full run is `pnpm -w check:evals`)."""

from __future__ import annotations

import importlib.util
import sys

from .conftest import ROOT


def runner():
    spec = importlib.util.spec_from_file_location("eval_runner", ROOT / "evals" / "run.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules["eval_runner"] = mod  # dataclasses look their module up here
    spec.loader.exec_module(mod)  # type: ignore[union-attr]
    return mod


def test_word_error_rate() -> None:
    r = runner()
    assert r.wer("the cat sat", "the cat sat") == 0
    assert r.wer("the cat sat on the mat", "the cat sat on mat") == 1 / 6  # one deletion
    assert r.wer("deploy on Thursday", "Deploy, on Thursday!") == 0  # case and punctuation
    assert r.wer("a b", "a b a b") == 1.0  # duplicated captions count as errors


def test_regressions_are_caught() -> None:
    r = runner()
    good = {
        "me_vs_others": 1.0,
        "named_speakers": 1.0,
        "action_item_recall": 1.0,
        "live_cards": 1.0,
        "wer": 0.0,
        "provider_switched": True,
        "latency": {"card.total_ms": {"p95": 20}},
    }
    base = {
        k: good[k]
        for k in ("me_vs_others", "named_speakers", "action_item_recall", "live_cards", "wer")
    }
    assert r.regressions(good, base) == []
    bad = good | {
        "wer": 0.08,
        "live_cards": 0.8,
        "named_speakers": 0.6,
        "provider_switched": False,
        "latency": {"card.total_ms": {"p95": 5000}},
    }
    problems = "\n".join(r.regressions(bad, base))
    for needle in (
        "wer rose",
        "live_cards fell",
        "named_speakers 0.6 is below",
        "card.total_ms p95",
        "provider switch",
    ):
        assert needle in problems
