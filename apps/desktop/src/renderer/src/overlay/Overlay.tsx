import type { OverlayAction } from "../../../shared/ipc";
import { RecordingIndicator } from "../components/RecordingIndicator";
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

/**
 * Always-on-top, never-focused panel. Compact: status, last caption, newest card, actions.
 * Expanded: scrolling captions and the card stack.
 */
export function Overlay() {
  const state = useAppState();
  const [settings] = useSettings();
  if (!state) return null;
  const expanded = state.overlayExpanded;

  return (
    <div data-testid="overlay" data-expanded={expanded} className="flex h-full flex-col text-sm">
      <header className="drag flex items-center justify-between gap-2 border-b border-white/10 px-3 py-1.5">
        <RecordingIndicator state={state} compact />
        <div className="flex items-center gap-2">
          {/* Level meters arrive with audio capture (Prompt 3). */}
          <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-gray-300" title="Provider serving cards">
            no provider
          </span>
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

      <div className="flex-1 overflow-y-auto px-3 py-1.5" style={{ fontSize: settings ? `${settings.captionFontSize}px` : undefined }}>
        <p data-testid="caption-line" className="truncate text-gray-300">
          {state.capturing ? "Listening…" : "Captions appear here while recording."}
        </p>
        {expanded && (
          <div className="mt-3 space-y-2 text-xs">
            <p className="text-gray-400">Answer cards, your standup script and topic cards stack here.</p>
            {state.lastAction && (
              <div className="rounded border border-white/10 bg-white/5 p-2">
                {ACTION_LABEL[state.lastAction.action]} is not connected yet.
              </div>
            )}
          </div>
        )}
        {!expanded && state.lastAction && (
          <p className="truncate text-xs text-gray-400">{ACTION_LABEL[state.lastAction.action]} is not connected yet.</p>
        )}
      </div>

      <footer className="no-drag flex gap-1 border-t border-white/10 px-2 py-1.5">
        {ACTIONS.map((a) => (
          <button
            key={a.action}
            type="button"
            title={`Ctrl/Cmd+Shift+${a.key}`}
            className="flex-1 rounded bg-white/10 px-2 py-1 text-xs hover:bg-white/20"
            onClick={() => void window.copilot.overlay.action(a.action)}
          >
            {a.label}
          </button>
        ))}
      </footer>
    </div>
  );
}
