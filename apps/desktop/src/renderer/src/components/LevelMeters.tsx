import { useEffect, useState } from "react";
import type { AudioLevels, ChannelState } from "../../../shared/ipc";

function Bar({ label, value, state }: { label: string; value: number; state: ChannelState }) {
  const off = state.state !== "live" && state.state !== "silent";
  return (
    <div className="flex items-center gap-1" title={`${label}: ${state.state}${state.message ? ` — ${state.message}` : ""}`}>
      <span className="w-6 text-[10px] text-gray-400">{label}</span>
      <div
        className="h-1.5 w-14 overflow-hidden rounded bg-white/10"
        role="meter"
        aria-label={`${label} level`}
        aria-valuemin={0}
        aria-valuemax={1}
        aria-valuenow={value}
        data-testid={`meter-${label.toLowerCase()}`}
        data-state={state.state}
      >
        <div className={`h-full ${off ? "bg-gray-500" : "bg-green-500"} transition-[width] duration-75`} style={{ width: `${Math.round(value * 100)}%` }} />
      </div>
    </div>
  );
}

export function LevelMeters({ mic, system }: { mic: ChannelState; system: ChannelState }) {
  const [levels, setLevels] = useState<AudioLevels>({ mic: 0, system: 0 });
  useEffect(() => window.copilot.onLevels(setLevels), []);
  return (
    <div className="flex flex-col gap-0.5">
      <Bar label="You" value={levels.mic} state={mic} />
      <Bar label="Mtg" value={levels.system} state={system} />
    </div>
  );
}
