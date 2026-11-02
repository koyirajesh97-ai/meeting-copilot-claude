import { useRef, useState } from "react";
import type { LiveState, OverlayAction } from "../../../shared/ipc";
import { LevelMeters } from "../components/LevelMeters";
import { RecordingIndicator } from "../components/RecordingIndicator";
import { visibleLines } from "../live/captions";
import { Captions } from "../live/Captions";
import { CardStack, useCards } from "../live/CardStack";
import { visibleCards } from "../live/cards";
import { useCaptions } from "../live/useCaptions";
import { useAppState, useSettings } from "../useAppState";

const ACTIONS: { action: OverlayAction; label: string; key: string }[] = [
  { action: "catch_up", label: "Catch me up", key: "C" },
  { action: "clarify", label: "Clarify", key: "L" },
  { action: "follow_up", label: "I'll follow up", key: "F" },
];

const ACTION_LABEL: Record<OverlayAction, string> = {
  catch_up: "Catch me up",
  clarify: "Clarify",
  follow_up: "I'll follow up",
};

function LiveChip({ live, provider }: { live: LiveState; provider: string | null }) {
  const text =
    live.status === "live" ? (provider ?? "live") : live.status === "off" ? "offline" : live.status.replace("-", " ");
  const color = live.status === "live" ? "bg-green-900/60 text-green-200" : live.status === "off" ? "bg-white/10 text-gray-300" : "bg-amber-900/60 text-amber-200";
  return (
    <span data-testid="live-status" data-status={live.status} className={`max-w-28 truncate rounded px-1.5 py-0.5 text-[10px] ${color}`} title={live.message ?? text}>
      {text}
    </span>
  );
}

/**
 * Always-on-top, never-focused panel. Compact: status, last caption, actions.
 * Expanded: scrolling captions (and, with live help, the card stack).
 */
export function Overlay() {
  const state = useAppState();
  const [settings] = useSettings();
  const captions = useCaptions();
  const [cards, dispatchCards] = useCards();
  if (!state) return null;
  const expanded = state.overlayExpanded;
  const lines = visibleLines(captions);
  const last = lines.at(-1);
  const fontSize = settings?.captionFontSize ?? 15;

  return (
    <div data-testid="overlay" data-expanded={expanded} className="flex h-full flex-col text-sm">
      <header className="drag flex items-center justify-between gap-2 border-b border-white/10 px-3 py-1.5">
        <span className="flex items-center gap-1.5">
          <RecordingIndicator state={state} compact />
          {state.capturing && state.meetingMode === "local" && (
            <span data-testid="mode-badge" className="rounded bg-emerald-900/70 px-1.5 py-0.5 text-[10px] font-medium text-emerald-200" title="Local-only: nothing leaves this computer">
              Local
            </span>
          )}
          {state.capturing && state.meetingMode === "live-only" && (
            <span data-testid="mode-badge" className="rounded bg-violet-900/70 px-1.5 py-0.5 text-[10px] font-medium text-violet-200" title="Live-only: nothing is saved">
              Live-only
            </span>
          )}
        </span>
        <div className="flex items-center gap-2">
          {state.capturing && <PauseControl paused={state.paused} />}
          {state.capturing && <LevelMeters mic={state.audio.mic} system={state.audio.system} />}
          {state.capturing && <LiveChip live={state.live} provider={captions.provider} />}
          <button
            type="button"
            className="no-drag rounded px-1.5 text-gray-300 hover:bg-white/10"
            aria-label={expanded ? "Compact overlay" : "Expand overlay"}
            title="Ctrl/Cmd+Shift+E"
            onClick={() => void window.copilot.overlay.setExpanded(!expanded)}
          >
            {expanded ? "▾" : "▸"}
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col px-3 py-1.5">
        {state.capturing && ["silent", "unavailable", "error"].includes(state.audio.system.state) && (
          <p data-testid="system-audio-warning" className="mb-1 flex items-center gap-2 text-xs text-amber-300">
            <span className="truncate">{state.audio.system.message ?? "No meeting audio"}</span>
            <button type="button" className="no-drag shrink-0 underline" onClick={() => void window.copilot.openMain("/help/system-audio")}>
              Help
            </button>
          </p>
        )}
        {state.capturing && state.audio.mic.state === "error" && (
          <p className="mb-1 truncate text-xs text-amber-300" title={state.audio.mic.message}>Microphone isn't recording: {state.audio.mic.message}</p>
        )}
        {state.capturing && state.live.status !== "live" && state.live.message && (
          <p data-testid="live-message" className="mb-1 truncate text-xs text-amber-300" title={state.live.message}>{state.live.message}</p>
        )}
        {expanded ? (
          <>
            <CardStack state={cards} dispatch={dispatchCards} />
            <Captions lines={lines} fontSize={fontSize} />
          </>
        ) : visibleCards(cards, Date.now()).shown[0] ? (
          <p data-testid="compact-card" className="truncate text-xs text-sky-200" title="Expand to see the card">
            {visibleCards(cards, Date.now()).shown[0].text.split("\n")[0]}
          </p>
        ) : (
          <p data-testid="caption-line" className={`truncate ${last && !last.final ? "text-gray-400 italic" : "text-gray-100"}`} style={{ fontSize: `${fontSize}px` }}>
            {last ? `${last.speaker}: ${last.text}` : state.capturing ? "Listening…" : "Captions appear here while recording."}
          </p>
        )}
        {state.lastAction && (
          <p className="truncate text-xs text-gray-400" data-testid="action-note">
            {ACTION_LABEL[state.lastAction.action]} works during a signed-in meeting.
          </p>
        )}
      </div>

      <footer className="no-drag flex gap-1 border-t border-white/10 px-2 py-1.5">
        {ACTIONS.map((a) => (
          <ActionButton key={a.action} action={a.action} label={a.label} hotkey={a.key} />
        ))}
      </footer>
    </div>
  );
}

/** Catch me up: click for the last 2 minutes, press and hold for 5. */
function ActionButton({ action, label, hotkey }: { action: OverlayAction; label: string; hotkey: string }) {
  const hold = useRef<ReturnType<typeof setTimeout> | null>(null);
  const long = useRef(false);
  const start = () => {
    long.current = false;
    if (action !== "catch_up") return;
    hold.current = setTimeout(() => {
      long.current = true;
      void window.copilot.overlay.action("catch_up", 5);
    }, 600);
  };
  const end = () => {
    if (hold.current) clearTimeout(hold.current);
    hold.current = null;
  };
  return (
    <button
      type="button"
      title={action === "catch_up" ? `Last 2 minutes (hold for 5) · Ctrl/Cmd+Shift+${hotkey}` : `Ctrl/Cmd+Shift+${hotkey}`}
      className="flex-1 rounded bg-white/10 px-2 py-1 text-xs hover:bg-white/20"
      onPointerDown={start}
      onPointerUp={end}
      onPointerLeave={end}
      onClick={() => {
        if (!long.current) void window.copilot.overlay.action(action);
      }}
    >
      {label}
    </button>
  );
}

/** Pause stops capture at once; Resume asks first, so recording never restarts by accident. */
function PauseControl({ paused }: { paused: boolean }) {
  const [confirming, setConfirming] = useState(false);
  const cls = "no-drag rounded bg-white/10 px-1.5 py-0.5 text-[10px] hover:bg-white/20";
  if (!paused) {
    return (
      <button type="button" className={cls} onClick={() => void window.copilot.privacy.pause()}>
        Pause
      </button>
    );
  }
  if (!confirming) {
    return (
      <button type="button" className={cls} onClick={() => setConfirming(true)}>
        Resume
      </button>
    );
  }
  return (
    <span className="no-drag flex items-center gap-1 text-[10px]" role="group" aria-label="Resume recording?">
      <span className="text-amber-200">Resume recording?</span>
      <button type="button" className={cls} onClick={() => void window.copilot.privacy.resume().then(() => setConfirming(false))}>
        Yes, resume
      </button>
      <button type="button" className={cls} onClick={() => setConfirming(false)}>
        Cancel
      </button>
    </span>
  );
}
