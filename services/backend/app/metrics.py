"""Per-stage latency, overall and per provider, for GET /metrics. In-process; last N samples."""

from __future__ import annotations

import threading
from collections import defaultdict, deque

MAX_SAMPLES = 2000


def _pct(sorted_vals: list[float], p: float) -> float:
    if not sorted_vals:
        return 0.0
    k = min(len(sorted_vals) - 1, max(0, round(p * (len(sorted_vals) - 1))))
    return sorted_vals[k]


def _summary(vals: deque[float]) -> dict[str, float]:
    s = sorted(vals)
    return {
        "count": len(s),
        "p50": round(_pct(s, 0.5), 1),
        "p95": round(_pct(s, 0.95), 1),
        "max": round(s[-1], 1),
    }


class Metrics:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._stages: dict[str, deque[float]] = defaultdict(lambda: deque(maxlen=MAX_SAMPLES))
        self._by_provider: dict[tuple[str, str], deque[float]] = defaultdict(
            lambda: deque(maxlen=MAX_SAMPLES)
        )

    def record(self, stage: str, ms: float, provider: str | None = None) -> None:
        with self._lock:
            self._stages[stage].append(ms)
            if provider:
                self._by_provider[(stage, provider)].append(ms)

    def snapshot(self) -> dict[str, dict]:
        with self._lock:
            out: dict[str, dict] = {}
            for stage, vals in self._stages.items():
                if not vals:
                    continue
                out[stage] = {**_summary(vals), "providers": {}}
            for (stage, provider), vals in self._by_provider.items():
                if vals and stage in out:
                    out[stage]["providers"][provider] = _summary(vals)
            return out

    def reset(self) -> None:
        with self._lock:
            self._stages.clear()
            self._by_provider.clear()


metrics = Metrics()
