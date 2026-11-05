// The desktop overlay is its own always-on-top window. In a browser it's a floating panel in the
// corner while recording, and "Pop out" moves it into a small always-on-top window (Document
// Picture-in-Picture, Chrome and Edge) so it stays visible over the meeting tab.

import { Minimize2, PictureInPicture2 } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Overlay } from "@desktop/renderer/src/overlay/Overlay";
import { useAppState } from "@desktop/renderer/src/useAppState";

const SIZE = { compact: { width: 380, height: 128 }, expanded: { width: 380, height: 520 } };

interface PipApi {
  requestWindow(opts: { width: number; height: number }): Promise<Window>;
  window: Window | null;
}
const pip = (): PipApi | null => (globalThis as { documentPictureInPicture?: PipApi }).documentPictureInPicture ?? null;

/** Copy this page's styles into the pop-out window so the overlay looks the same there. */
function copyStyles(to: Window): void {
  for (const node of document.querySelectorAll('style, link[rel="stylesheet"]')) to.document.head.appendChild(node.cloneNode(true));
  to.document.body.className = "overlay";
  to.document.documentElement.dataset.theme = document.documentElement.dataset.theme ?? "";
  to.document.title = "Meeting Copilot";
}

export function WebOverlay({ raised = false }: { raised?: boolean }) {
  const state = useAppState();
  const [popout, setPopout] = useState<Window | null>(null);
  const [hidden, setHidden] = useState(false);
  const capturing = !!state?.capturing;
  const size = state?.overlayExpanded ? SIZE.expanded : SIZE.compact;

  // Close the pop-out when recording stops; reopen the panel for the next meeting.
  useEffect(() => {
    if (capturing) return;
    popout?.close();
    setPopout(null);
    setHidden(false);
  }, [capturing, popout]);
  useEffect(() => {
    popout?.resizeTo(size.width, size.height + 32);
  }, [popout, size.width, size.height]);

  if (!capturing) return null;
  const corner = raised ? "bottom-12 right-4" : "bottom-4 right-4";

  const popOut = async () => {
    const api = pip();
    if (!api) return;
    const w = await api.requestWindow(size);
    copyStyles(w);
    w.addEventListener("pagehide", () => setPopout(null), { once: true });
    setPopout(w);
  };

  if (popout) return createPortal(<div style={{ height: "100vh" }}><Overlay /></div>, popout.document.body);
  if (hidden) {
    return (
      <button
        type="button"
        data-testid="overlay-show"
        onClick={() => setHidden(false)}
        className={`overlay-panel fixed ${corner} z-50 rounded-full px-3 py-1.5 text-xs font-medium shadow-lg ring-1 ring-white/10`}
      >
        Show overlay
      </button>
    );
  }
  return (
    <aside
      aria-label="Meeting overlay"
      className={`overlay-panel fixed ${corner} z-50 flex max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl shadow-2xl shadow-black/40 ring-1 ring-white/10`}
      style={{ width: size.width, height: size.height + 26 }}
    >
      <div className="flex items-center justify-end gap-1 bg-black/20 px-2 py-0.5 text-[10px] text-slate-400">
        {pip() && (
          <button type="button" className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-white/10 hover:text-white" onClick={() => void popOut()} title="Keep it on top of the meeting tab">
            <PictureInPicture2 size={11} aria-hidden />
            Pop out
          </button>
        )}
        <button type="button" className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-white/10 hover:text-white" onClick={() => setHidden(true)}>
          <Minimize2 size={11} aria-hidden />
          Hide
        </button>
      </div>
      <div className="min-h-0 flex-1">
        <Overlay />
      </div>
    </aside>
  );
}
