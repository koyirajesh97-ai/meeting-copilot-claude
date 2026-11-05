import { AudioLines, ChevronDown, ChevronUp, CircleHelp, History, Pause, Play, Reply, TriangleAlert, type LucideIcon } from "lucide-react";
import { useRef, useState } from "react";
import type { LiveState, OverlayAction } from "../../../shared/ipc";
import { LevelMeters } from "../components/LevelMeters";
import { RecordingIndicator } from "../components/RecordingIndicator";
import { visibleLines } from "@meeting-copilot/shared";
import { Captions } from "../live/Captions";
import { CardStack, useCards } from "../live/CardStack";
import { visibleCards } from "@meeting-copilot/shared";
import { useCaptions } from "../live/useCaptions";
import { useAppState, useSettings } from "../useAppState";

const ACTIONS: { action: OverlayAction; label: string; key: string; icon: LucideIcon }[] = [
  { action: "catch_up", label: "Catch me up", key: "C", icon: History },
  { action: "clarify", label: "Clarify", key: "L", icon: CircleHelp },
  { action: "follow_up", label: "I'll follow up", key: "F", icon: Reply },
];

const ACTION_LABEL: Record<OverlayAction, string> = {
  catch_up: "Catch me up",
  clarify: "Clarify",
  follow_up: "I'll follow up",
};

function LiveChip({ live, provider }: { live: LiveState; provider: string | null }) {
  // Live is just a green "Live"; the provider name is in the tooltip, not on screen.
  const text = live.status === "live" ? "Live" : live.status === "off" ? "offline" : live.status.replace("-", " ");
  const color =
    live.status === "live"
      ? "bg-emerald-400/10 text-emerald-300 ring-emerald-400/30"
      : live.status === "off"
        ? "bg-white/5 text-slate-400 ring-white/10"
        : "bg-amber-400/10 text-amber-300 ring-amber-400/30";
  const dot = live.status === "live" ? "bg-emerald-400" : live.status === "off" ? "bg-slate-500" : "animate-pulse bg-amber-400";
  return (
    <span
      data-testid="live-status"
      data-status={live.status}
      className={`flex max-w-28 items-center gap-1.5 truncate rounded-full px-2 py-0.5 text-[10px] font-medium capitalize ring-1 ${color}`}
      title={live.message ?? (live.status === "live" && provider ? `Live · ${provider}` : text)}
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} aria-hidden />
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
      <header className="drag flex items-center justify-between gap-2 border-b border-white/[0.07] px-3 py-1.5">
        <span className="flex items-center gap-2">
          <span className="grid h-5 w-5 place-items-center rounded-md bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow shadow-indigo-500/40" aria-hidden>
            <AudioLines size={12} strokeWidth={2.5} />
          </span>
          <RecordingIndicator state={state} compact />
          {state.capturing && state.meetingMode === "local" && (
            <span data-testid="mode-badge" className="rounded-full bg-emerald-400/10 px-2 py-0.5 text-[10px] font-medium text-emerald-300 ring-1 ring-emerald-400/30" title="Local-only: nothing leaves this computer">
              Local
            </span>
          )}
          {state.capturing && state.meetingMode === "live-only" && (
            <span data-testid="mode-badge" className="rounded-full bg-violet-400/10 px-2 py-0.5 text-[10px] font-medium text-violet-300 ring-1 ring-violet-400/30" title="Live-only: nothing is saved">
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
            className="no-drag grid h-6 w-6 place-items-center rounded-md text-slate-400 transition hover:bg-white/10 hover:text-white"
            aria-label={expanded ? "Compact overlay" : "Expand overlay"}
            title="Ctrl/Cmd+Shift+E"
            onClick={() => void window.copilot.overlay.setExpanded(!expanded)}
          >
            {expanded ? <ChevronUp size={15} aria-hidden /> : <ChevronDown size={15} aria-hidden />}
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col justify-center px-3 py-1">
        {state.capturing && ["silent", "unavailable", "error"].includes(state.audio.system.state) && (
          <p data-testid="system-audio-warning" className="mb-2 flex items-center gap-2 rounded-lg bg-amber-400/10 px-2 py-1 text-xs text-amber-200 ring-1 ring-amber-400/20">
            <TriangleAlert size={13} className="shrink-0" aria-hidden />
            <span className="truncate" title={state.audio.system.message}>Not hearing the meeting</span>
            <button type="button" className="no-drag ml-auto shrink-0 font-medium underline" onClick={() => void window.copilot.openMain("/help/system-audio")}>
              Fix
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
          <p data-testid="compact-card" className="truncate rounded-lg bg-indigo-400/10 px-2 py-1 text-xs text-indigo-100 ring-1 ring-indigo-400/25" title="Expand to see the card">
            {visibleCards(cards, Date.now()).shown[0].text.split("\n")[0]}
          </p>
        ) : (
          <p data-testid="caption-line" className={`truncate ${last && !last.final ? "text-slate-400 italic" : "text-slate-100"}`} style={{ fontSize: `${fontSize}px` }}>
            {last ? `${last.speaker}: ${last.text}` : state.capturing ? "Listening…" : "Captions appear here while recording."}
          </p>
        )}
        {state.lastAction && (
          <p className="truncate text-xs text-gray-400" data-testid="action-note">
            {ACTION_LABEL[state.lastAction.action]} works during a signed-in meeting.
          </p>
        )}
      </div>

      <footer className="no-drag flex gap-1.5 border-t border-white/[0.07] px-2 py-1.5">
        {ACTIONS.map((a) => (
          <ActionButton key={a.action} action={a.action} label={a.label} hotkey={a.key} icon={a.icon} />
        ))}
      </footer>
    </div>
  );
}

/** Catch me up: click for the last 2 minutes, press and hold for 5. */
function ActionButton({ action, label, hotkey, icon: Icon }: { action: OverlayAction; label: string; hotkey: string; icon: LucideIcon }) {
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
      className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-white/[0.06] px-2 py-1 text-xs font-medium text-slate-200 ring-1 ring-white/10 transition hover:bg-white/[0.12] hover:text-white active:scale-[0.98]"
      onPointerDown={start}
      onPointerUp={end}
      onPointerLeave={end}
      onClick={() => {
        if (!long.current) void window.copilot.overlay.action(action);
      }}
    >
      <Icon size={13} className="text-indigo-300" aria-hidden />
      {label}
    </button>
  );
}

/** Pause stops capture at once; Resume asks first, so recording never restarts by accident. */
function PauseControl({ paused }: { paused: boolean }) {
  const [confirming, setConfirming] = useState(false);
  const cls = "no-drag inline-flex items-center gap-1 rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] font-medium text-slate-200 ring-1 ring-white/10 hover:bg-white/[0.12]";
  if (!paused) {
    return (
      <button type="button" className={cls} onClick={() => void window.copilot.privacy.pause()}>
        <Pause size={10} aria-hidden />
        Pause
      </button>
    );
  }
  if (!confirming) {
    return (
      <button type="button" className={cls} onClick={() => setConfirming(true)}>
        <Play size={10} aria-hidden />
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
