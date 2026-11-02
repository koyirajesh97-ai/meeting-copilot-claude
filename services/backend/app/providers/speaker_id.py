"""Voice embeddings for recognizing enrolled speakers. Runs locally; audio never leaves the
machine for this. Input: 16 kHz mono PCM16 bytes. Output: a normalized vector.

- PyannoteEmbedder: pyannote.audio with the WeSpeaker ResNet34 model that pyannote's
  Community-1 pipeline uses (optional extra `speakers`; needs HF_TOKEN and the model terms).
- FakeSpeakerEmbedder: a pitch/spectrum signature (Goertzel filter bank). Good enough to tell
  synthetic test voices apart; not for real use.
"""

from __future__ import annotations

import array
import asyncio
import math
import os
from functools import lru_cache
from typing import Protocol

from app.router.config import Deployment, RouterConfig


class SpeakerEmbedder(Protocol):
    name: str

    def available(self) -> bool: ...

    async def embed(self, pcm: bytes) -> list[float]: ...


def normalize(v: list[float]) -> list[float]:
    n = math.sqrt(sum(x * x for x in v)) or 1.0
    return [x / n for x in v]


def cosine(a: list[float], b: list[float]) -> float:
    if len(a) != len(b):
        return 0.0
    return sum(x * y for x, y in zip(a, b, strict=True))


def _goertzel(samples: list[float], rate: int, freq: float) -> float:
    k = 2 * math.cos(2 * math.pi * freq / rate)
    s1 = s2 = 0.0
    for x in samples:
        s1, s2 = x + k * s1 - s2, s1
    return math.sqrt(max(0.0, s1 * s1 + s2 * s2 - k * s1 * s2))


def _pitch(seg: list[float], rate: int) -> float | None:
    """Fundamental frequency by autocorrelation (50-400 Hz), or None if unvoiced.

    Takes the first strong peak rather than the highest, which avoids octave errors (a lag of
    two periods correlates almost as well as one)."""
    energy = sum(x * x for x in seg) or 1.0
    lags = range(rate // 400, rate // 50)
    corr = [sum(seg[i] * seg[i + lag] for i in range(0, len(seg) - lag, 2)) for lag in lags]
    top = max(corr)
    if top / (energy / 2) <= 0.3:
        return None
    for k in range(1, len(corr) - 1):
        if corr[k] >= 0.85 * top and corr[k] >= corr[k - 1] and corr[k] >= corr[k + 1]:
            return rate / lags[k]
    return rate / lags[corr.index(top)]


class FakeSpeakerEmbedder:
    """Pitch distribution (most of the signal) plus coarse spectral shape. Test voices only."""

    name = "fake/pitch-signature"
    PITCH_BINS = [60 + 8 * i for i in range(45)]  # 60-412 Hz
    SPECTRUM = [500, 700, 900, 1200, 1500, 2000, 2500, 3000]

    def available(self) -> bool:
        return True

    async def embed(self, pcm: bytes) -> list[float]:
        a = array.array("h", pcm[: len(pcm) // 2 * 2])
        rate, win = 8000, 2000  # decimate to 8 kHz; 250 ms windows
        x = [v / 32768 for v in a[::2]]
        pitch = [0.0] * len(self.PITCH_BINS)
        spec = [0.0] * len(self.SPECTRUM)
        windows = 0
        for start in range(0, max(0, len(x) - win), win):
            seg = x[start : start + win]
            if max(abs(v) for v in seg) < 0.02:
                continue
            f0 = _pitch(seg, rate)
            if f0 is None:
                continue
            for i, b in enumerate(self.PITCH_BINS):
                pitch[i] += math.exp(-(((f0 - b) / 8) ** 2))
            for i, f in enumerate(self.SPECTRUM):
                spec[i] += math.log(_goertzel(seg, rate, f) + 1e-6)
            windows += 1
            if windows >= 24:
                break
        if not windows:
            return [0.0] * (len(pitch) + len(spec))
        p = normalize(pitch)
        mean = sum(spec) / len(spec)
        sp = normalize([v - mean for v in spec])
        return normalize([v for v in p] + [0.3 * v for v in sp])


@lru_cache(maxsize=1)
def _pyannote(model: str, token: str):
    from pyannote.audio import Inference, Model  # optional dependency: uv sync --extra speakers

    return Inference(Model.from_pretrained(model, use_auth_token=token), window="whole")


class PyannoteEmbedder:
    def __init__(self, model: str = "pyannote/wespeaker-voxceleb-resnet34-LM") -> None:
        self.name = f"local/{model.split('/')[-1]}"
        self.model = model

    def available(self) -> bool:
        if not os.environ.get("HF_TOKEN"):
            return False
        try:
            import pyannote.audio  # noqa: F401
        except ImportError:
            return False
        return True

    async def embed(self, pcm: bytes) -> list[float]:
        def run() -> list[float]:
            import numpy as np
            import torch

            wav = torch.from_numpy(
                np.frombuffer(pcm, dtype=np.int16).astype("float32") / 32768
            ).unsqueeze(0)
            vec = _pyannote(self.model, os.environ["HF_TOKEN"])(
                {"waveform": wav, "sample_rate": 16_000}
            )
            return normalize([float(x) for x in np.asarray(vec).ravel()])

        return await asyncio.to_thread(run)


def default_factory(d: Deployment, _cfg: RouterConfig) -> SpeakerEmbedder | None:
    if d.provider == "local" and d.model.startswith("pyannote"):
        return PyannoteEmbedder()
    if d.provider == "fake":
        return FakeSpeakerEmbedder()
    return None


class SpeakerIdUnavailable(RuntimeError):
    pass


class SpeakerIdRouter:
    """First available embedder in `tasks.speaker_id` (all local, so no data-policy question)."""

    def __init__(self, cfg: RouterConfig, factory=default_factory) -> None:
        self.cfg = cfg
        self.factory = factory
        self._chosen: SpeakerEmbedder | None = None

    def embedder(self) -> SpeakerEmbedder | None:
        if self._chosen is None:
            for d in self.cfg.tasks.get("speaker_id", []):
                e = self.factory(d, self.cfg)
                if e is not None and e.available():
                    self._chosen = e
                    break
        return self._chosen

    async def embed(self, pcm: bytes) -> tuple[list[float], str]:
        e = self.embedder()
        if e is None:
            raise SpeakerIdUnavailable(
                "No speaker-recognition model available (install the `speakers` extra)"
            )
        return await e.embed(pcm), e.name
