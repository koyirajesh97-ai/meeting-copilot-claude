import { useEffect, useState } from "react";
import type { AppState } from "../../../shared/ipc";
import { formatElapsed } from "../format";

/** Red dot and timer whenever audio is captured. Always visible; never hidden. */
export function RecordingIndicator({ state, compact = false }: { state: AppState; compact?: boolean }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!state.capturing) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [state.capturing]);

  if (!state.capturing) {
    return (
      <span data-testid="recording-indicator" data-recording="false" className="flex items-center gap-1.5 text-xs text-gray-400">
        <span className="h-2.5 w-2.5 rounded-full bg-gray-400" aria-hidden />
        {compact ? "Idle" : "Not recording"}
      </span>
    );
  }
  return (
    <span
      data-testid="recording-indicator"
      data-recording="true"
      role="status"
      aria-label="Recording"
      className="flex items-center gap-1.5 text-xs font-medium text-red-500"
    >
      <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-600" aria-hidden />
      REC {formatElapsed(now - (state.captureStartedAt ?? now))}
    </span>
  );
}
