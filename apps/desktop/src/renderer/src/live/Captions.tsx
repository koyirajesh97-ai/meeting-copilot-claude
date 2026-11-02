import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CaptionLine } from "./captions";

/** Scrolling captions: partials grey, finals normal. Auto-scroll pauses while you scroll up. */
export function Captions({ lines, fontSize }: { lines: CaptionLine[]; fontSize: number }) {
  const box = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(true);

  useLayoutEffect(() => {
    const el = box.current;
    if (el && pinned) el.scrollTop = el.scrollHeight;
  }, [lines, pinned]);

  useEffect(() => {
    if (lines.length === 0) setPinned(true);
  }, [lines.length]);

  const onScroll = () => {
    const el = box.current;
    if (!el) return;
    setPinned(el.scrollHeight - el.scrollTop - el.clientHeight < 24);
  };

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={box}
        onScroll={onScroll}
        data-testid="captions"
        data-pinned={pinned}
        className="no-drag h-full space-y-1 overflow-y-auto pr-1"
        style={{ fontSize: `${fontSize}px` }}
        aria-live="polite"
      >
        {lines.length === 0 && <p className="text-gray-400">Captions appear here while recording.</p>}
        {lines.map((l) => (
          <p key={l.key} data-testid={l.final ? "caption-final" : "caption-partial"} className={l.final ? "text-gray-100" : "text-gray-400 italic"}>
            <span className={`mr-1.5 font-semibold ${l.speakerId === "me" ? "text-sky-300" : "text-amber-200"}`}>{l.speaker}:</span>
            {l.text}
          </p>
        ))}
      </div>
      {!pinned && (
        <button
          type="button"
          className="no-drag absolute right-1 bottom-1 rounded bg-sky-700 px-2 py-0.5 text-[10px] text-white shadow"
          onClick={() => {
            setPinned(true);
            const el = box.current;
            if (el) el.scrollTop = el.scrollHeight;
          }}
        >
          Jump to latest
        </button>
      )}
    </div>
  );
}
