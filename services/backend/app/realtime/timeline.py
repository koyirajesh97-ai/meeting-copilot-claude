"""Map a provider's audio offsets back to meeting time.

Providers time results by the audio they've received. Mic audio is VAD-gated (silence is never
sent), and a provider switch restarts the provider's clock at zero, so audio offset != meeting
time. Each STT session keeps checkpoints (audio_ms, wall_ms) taken whenever audio resumes after
a gap; results are placed relative to the nearest checkpoint before them.
"""

from __future__ import annotations

import bisect
import time

GAP_MS = 200
BYTES_PER_MS = 32  # 16 kHz * 2 bytes / 1000


def now_ms() -> float:
    return time.time() * 1000


class Timeline:
    def __init__(self, meeting_start_wall_ms: float) -> None:
        self.meeting_start = meeting_start_wall_ms
        self._audio: list[float] = []
        self._wall: list[float] = []
        self.audio_ms = 0.0

    def on_audio(self, nbytes: int, wall_ms: float | None = None) -> None:
        """Call before sending `nbytes` of audio that arrived at `wall_ms`."""
        wall = now_ms() if wall_ms is None else wall_ms
        if not self._audio:
            self._checkpoint(wall)
        else:
            expected = self._wall[-1] + (self.audio_ms - self._audio[-1])
            # Audio resumed after a gap (VAD silence, reconnect): new anchor. Audio arriving
            # faster than real time (a replayed backlog) keeps the old anchor.
            if wall - expected > GAP_MS:
                self._checkpoint(wall)
        self.audio_ms += nbytes / BYTES_PER_MS

    def _checkpoint(self, wall: float) -> None:
        self._audio.append(self.audio_ms)
        self._wall.append(wall)

    def wall_at(self, audio_ms: float) -> float:
        if not self._audio:
            return self.meeting_start
        i = max(0, bisect.bisect_right(self._audio, audio_ms) - 1)
        return self._wall[i] + (audio_ms - self._audio[i])

    def meeting_ms(self, audio_ms: float) -> int:
        return max(0, round(self.wall_at(audio_ms) - self.meeting_start))
