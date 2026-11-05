import { useEffect, useState } from "react";
import type { AppState } from "../../../shared/ipc";
import { formatElapsed } from "../format";

/** Red dot and timer whenever audio is captured. Always visible; never hidden. */
export function RecordingIndicator({ state, compact = false }: { state: AppState; compact?: boolean }) {
  const [now, setNow] = useState(Date.now());
  const recording = state.capturing || state.enrolling;
  useEffect(() => {
    if (!recording) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [recording]);

  if (!recording) {
    return (
      <span data-testid="recording-indicator" data-recording="false" className="flex items-center gap-1.5 text-xs text-gray-400">
        <span className="h-2.5 w-2.5 rounded-full bg-gray-400" aria-hidden />
        {compact ? "Idle" : "Not recording"}
      </span>
    );
  }
  if (state.capturing && state.paused) {
    return (
      <span data-testid="recording-indicator" data-recording="paused" role="status" aria-label="Recording paused" className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-semibold tracking-wide text-amber-500 ring-1 ring-amber-500/30">
        <span className="h-2 w-2 rounded-sm bg-amber-500" aria-hidden />
        PAUSED
      </span>
    );
  }
  return (
    <span
      data-testid="recording-indicator"
      data-recording="true"
      role="status"
      aria-label="Recording"
      className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-red-500/10 px-2 py-0.5 text-[11px] font-semibold tracking-wide tabular-nums text-red-500 ring-1 ring-red-500/30"
    >
      <span className="h-2 w-2 animate-pulse rounded-full bg-red-500 shadow-[0_0_8px] shadow-red-500" aria-hidden />
      {state.enrolling && !state.capturing ? "REC voice sample" : `REC ${formatElapsed(now - (state.captureStartedAt ?? now))}`}
    </span>
  );
}
