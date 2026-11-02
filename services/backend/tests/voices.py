"""Synthetic voices for speaker-recognition tests (no real people's audio)."""

import math
import random
import struct


def voice(f0, seconds, seed):
    """A synthetic voiced sound: f0 with 5 harmonics, slight vibrato, syllable-like loudness."""
    rnd = random.Random(seed)
    n = int(16000 * seconds)
    out = []
    phase = 0.0
    for i in range(n):
        t = i / 16000
        f = f0 * (1 + 0.03 * math.sin(2 * math.pi * 5 * t))
        phase += 2 * math.pi * f / 16000
        s = sum((0.6 / k) * math.sin(k * phase) for k in range(1, 6))
        env = 0.6 + 0.4 * math.sin(2 * math.pi * 3 * t)
        out.append(int(max(-1, min(1, 0.3 * s * env + 0.01 * rnd.uniform(-1, 1))) * 32767))
    return struct.pack(f"<{n}h", *out)
