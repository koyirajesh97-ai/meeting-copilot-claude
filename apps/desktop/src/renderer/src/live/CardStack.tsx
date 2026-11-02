import { useEffect, useReducer, useState } from "react";
import type { MeetingEvent } from "@meeting-copilot/shared";
import { meetingRoute } from "../../../shared/ipc";
import { EMPTY_CARDS, reduceCards, sourceLabel, visibleCards, type CardAction, type CardState } from "./cards";

export function useCards(): [CardState, (a: CardAction) => void] {
  const [state, dispatch] = useReducer(reduceCards, EMPTY_CARDS);
  useEffect(() => window.copilot.onLive((event: MeetingEvent) => dispatch({ type: "event", event, now: Date.now() })), []);
  return [state, dispatch];
}

const KIND_LABEL: Record<string, string> = {
  answer: "Answer",
  standup: "Your standup",
  topic: "Topic",
  clarify: "Clarify",
  catch_up: "Catch up",
  follow_up: "Follow up",
};

export function CardStack({ state, dispatch }: { state: CardState; dispatch: (a: CardAction) => void }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);
  const { shown, queued } = visibleCards(state, now);
  if (shown.length === 0) return null;

  const feedback = (id: string, useful: boolean) => {
    dispatch({ type: "feedback", id, useful });
    void window.copilot.cardFeedback(id, useful).catch(() => undefined);
  };

  return (
    <div className="no-drag mb-2 space-y-1.5" data-testid="card-stack">
      {shown.map((c) => {
        const noAnswer = c.kind === "answer" && c.confidence === 0;
        return (
          <article
            key={c.id}
            data-testid="card"
            data-kind={c.kind}
            data-collapsed={c.collapsed}
            className={`rounded border p-2 text-xs ${c.kind === "answer" ? "border-sky-500/60 bg-sky-950/60" : "border-white/10 bg-white/5"}`}
          >
            <header className="mb-1 flex items-center justify-between gap-2">
              <span className="font-semibold text-sky-200">{KIND_LABEL[c.kind] ?? c.kind}</span>
              <span className="flex items-center gap-1">
                <span className="max-w-24 truncate rounded bg-white/10 px-1 text-[10px] text-gray-300" title="Provider" data-testid="card-provider">
                  {c.provider}
                </span>
                <button type="button" className="px-1 text-gray-300 hover:text-white" title={c.pinned ? "Unpin" : "Pin"} aria-label={c.pinned ? "Unpin card" : "Pin card"} onClick={() => dispatch({ type: "pin", id: c.id })}>
                  {c.pinned ? "★" : "☆"}
                </button>
                <button type="button" className="px-1 text-gray-300 hover:text-white" aria-label="Dismiss card" onClick={() => dispatch({ type: "dismiss", id: c.id })}>
                  ×
                </button>
              </span>
            </header>
            {c.collapsed ? (
              <p className="truncate text-gray-300">{c.text.split("\n")[0]}</p>
            ) : (
              <>
                <p className="whitespace-pre-line text-gray-100" data-testid="card-text">{c.text}</p>
                {c.sources.length > 0 && (
                  <p className="mt-1 flex flex-wrap gap-1" data-testid="card-sources">
                    {c.sources.map((s, i) => (
                      <button
                        key={i}
                        type="button"
                        className="rounded bg-white/10 px-1 text-[10px] text-gray-300 hover:bg-white/20"
                        disabled={s.type !== "meeting"}
                        onClick={() => void window.copilot.openMain(meetingRoute(s.id, s.at_ms))}
                      >
                        {sourceLabel(s, state.meetingId)}
                      </button>
                    ))}
                  </p>
                )}
                <footer className="mt-1.5 flex gap-1">
                  {noAnswer ? (
                    <button type="button" className="rounded bg-amber-700 px-2 py-0.5 text-white" onClick={() => void window.copilot.overlay.action("follow_up")}>
                      I'll follow up
                    </button>
                  ) : (
                    <>
                      <button type="button" aria-pressed={c.feedback === true} className={`rounded px-2 py-0.5 ${c.feedback === true ? "bg-green-700 text-white" : "bg-white/10"}`} onClick={() => feedback(c.id, true)}>
                        Used
                      </button>
                      <button type="button" aria-pressed={c.feedback === false} className={`rounded px-2 py-0.5 ${c.feedback === false ? "bg-gray-600 text-white" : "bg-white/10"}`} onClick={() => feedback(c.id, false)}>
                        Not useful
                      </button>
                    </>
                  )}
                </footer>
              </>
            )}
          </article>
        );
      })}
      {queued > 0 && <p className="text-[10px] text-gray-400">{queued} more card{queued > 1 ? "s" : ""} waiting</p>}
    </div>
  );
}
