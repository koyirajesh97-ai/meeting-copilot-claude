import { Sparkles, Star, ThumbsDown, ThumbsUp, X } from "lucide-react";
import { useEffect, useReducer, useState } from "react";
import type { MeetingEvent } from "@meeting-copilot/shared";
import { meetingRoute } from "../../../shared/ipc";
import { EMPTY_CARDS, reduceCards, sourceLabel, visibleCards, type CardAction, type CardState } from "@meeting-copilot/shared";

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
            className={`rounded-xl p-2.5 text-xs shadow-lg shadow-black/20 ring-1 ${c.kind === "answer" ? "bg-gradient-to-br from-indigo-500/20 to-violet-500/10 ring-indigo-400/40" : "bg-white/[0.05] ring-white/10"}`}
          >
            <header className="mb-1 flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 font-semibold text-indigo-200">
                <Sparkles size={12} className="text-indigo-300" aria-hidden />
                {KIND_LABEL[c.kind] ?? c.kind}
              </span>
              <span className="flex items-center gap-1">
                <span className="max-w-24 truncate rounded-full bg-white/[0.06] px-1.5 text-[10px] text-slate-400" title="Provider" data-testid="card-provider">
                  {c.provider}
                </span>
                <button type="button" className="grid h-5 w-5 place-items-center rounded text-slate-400 hover:bg-white/10 hover:text-white" title={c.pinned ? "Unpin" : "Pin"} aria-label={c.pinned ? "Unpin card" : "Pin card"} onClick={() => dispatch({ type: "pin", id: c.id })}>
                  <Star size={12} fill={c.pinned ? "currentColor" : "none"} aria-hidden />
                </button>
                <button type="button" className="grid h-5 w-5 place-items-center rounded text-slate-400 hover:bg-white/10 hover:text-white" aria-label="Dismiss card" onClick={() => dispatch({ type: "dismiss", id: c.id })}>
                  <X size={12} aria-hidden />
                </button>
              </span>
            </header>
            {c.collapsed ? (
              <p className="truncate text-slate-300">{c.text.split("\n")[0]}</p>
            ) : (
              <>
                <p className="whitespace-pre-line leading-relaxed text-slate-100" data-testid="card-text">{c.text}</p>
                {c.sources.length > 0 && (
                  <p className="mt-1 flex flex-wrap gap-1" data-testid="card-sources">
                    {c.sources.map((s, i) => (
                      <button
                        key={i}
                        type="button"
                        className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] text-slate-300 ring-1 ring-white/10 hover:bg-white/[0.12]"
                        disabled={s.type !== "meeting"}
                        onClick={() => void window.copilot.openMain(meetingRoute(s.id, s.at_ms))}
                      >
                        {sourceLabel(s, state.meetingId)}
                      </button>
                    ))}
                  </p>
                )}
                <footer className="mt-2 flex gap-1.5">
                  {noAnswer ? (
                    <button type="button" className="rounded-full bg-amber-500/90 px-2.5 py-0.5 font-medium text-amber-950" onClick={() => void window.copilot.overlay.action("follow_up")}>
                      I'll follow up
                    </button>
                  ) : (
                    <>
                      <button type="button" aria-pressed={c.feedback === true} className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 ring-1 ${c.feedback === true ? "bg-emerald-500/20 text-emerald-200 ring-emerald-400/40" : "bg-white/[0.06] text-slate-300 ring-white/10 hover:bg-white/[0.12]"}`} onClick={() => feedback(c.id, true)}>
                        <ThumbsUp size={11} aria-hidden />
                        Used
                      </button>
                      <button type="button" aria-pressed={c.feedback === false} className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 ring-1 ${c.feedback === false ? "bg-slate-500/30 text-white ring-slate-400/40" : "bg-white/[0.06] text-slate-300 ring-white/10 hover:bg-white/[0.12]"}`} onClick={() => feedback(c.id, false)}>
                        <ThumbsDown size={11} aria-hidden />
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
      {queued > 0 && <p className="text-[10px] text-slate-500">{queued} more card{queued > 1 ? "s" : ""} waiting</p>}
    </div>
  );
}
