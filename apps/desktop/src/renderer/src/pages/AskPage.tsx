import { useState } from "react";
import { Link } from "react-router-dom";
import { meetingRoute, type AskAnswer } from "../../../shared/ipc";
import { buttonClass, inputClass, PageHeader } from "../components/EmptyState";

interface Turn {
  question: string;
  answer?: AskAnswer;
  error?: string;
}

function clock(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export function AskPage() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);

  const ask = async () => {
    const question = q.trim();
    if (!question) return;
    setQ("");
    setBusy(true);
    setTurns((t) => [...t, { question }]);
    let turn: Turn;
    try {
      turn = { question, answer: await window.copilot.ask(question) };
    } catch (err) {
      turn = { question, error: (err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "") };
    }
    setTurns((t) => [...t.slice(0, -1), turn]);
    setBusy(false);
  };

  return (
    <section className="flex h-full max-w-3xl flex-col">
      <PageHeader title="Ask my meetings" />
      <div className="flex-1 space-y-6 overflow-y-auto pb-4" aria-live="polite">
        {turns.length === 0 && (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Ask anything that was said, e.g. "What did we decide about the retry limit?". Answers cite the meeting and
            the moment, and say so when nothing relevant exists.
          </p>
        )}
        {turns.map((t, i) => (
          <div key={i} className="space-y-2">
            <p className="font-medium">{t.question}</p>
            {!t.answer && !t.error && <p className="text-sm text-gray-500">Searching your meetings…</p>}
            {t.error && <p className="text-sm text-red-600" role="alert">{t.error}</p>}
            {t.answer && (
              <div data-testid="answer" data-found={t.answer.found} className="rounded-md border border-gray-200 p-3 text-sm dark:border-gray-800">
                <p>{t.answer.answer}</p>
                {t.answer.citations.length > 0 && (
                  <ul className="mt-3 space-y-1.5" aria-label="Sources">
                    {t.answer.citations.map((c) => (
                      <li key={c.id}>
                        <Link to={meetingRoute(c.meeting_id, c.start_ms)} className="text-indigo-700 underline dark:text-indigo-300" data-testid="citation">
                          [{c.id}] {c.title}
                          {c.start_ms !== null ? ` at ${clock(c.start_ms)}` : " (summary)"}
                        </Link>
                        <span className="ml-2 text-xs text-gray-500 dark:text-gray-400">{c.quote.split("\n")[0].slice(0, 140)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
      <form className="flex gap-2 border-t border-gray-200 pt-3 dark:border-gray-800" onSubmit={(e) => { e.preventDefault(); void ask(); }}>
        <input className={inputClass} placeholder="Ask about your meetings" aria-label="Question" value={q} onChange={(e) => setQ(e.target.value)} />
        <button type="submit" className={buttonClass} disabled={busy || !q.trim()}>Ask</button>
      </form>
    </section>
  );
}
