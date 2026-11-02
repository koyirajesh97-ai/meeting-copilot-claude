// Turn a summary into plain-text fields for editing (one item per line) and back.
// Action items are "text | owner | due" so they stay one line each.

import type { SummaryData } from "../../../shared/ipc";

export interface EditableSummary {
  overview: string;
  sections: Record<string, string>;
  decisions: string;
  action_items: string;
  takeaways: string;
  blockers: string;
  open_questions: string;
}

const lines = (s: string) =>
  s
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

export function toEditable(s: SummaryData): EditableSummary {
  return {
    overview: s.overview,
    sections: Object.fromEntries(s.sections.map((x) => [x.key, x.items.join("\n")])),
    decisions: s.decisions.map((d) => (d.rationale ? `${d.text} | ${d.rationale}` : d.text)).join("\n"),
    action_items: s.action_items
      .map((a) => [a.text, a.owner ?? "", a.due_date ?? ""].join(" | ").replace(/( \| )+$/, ""))
      .join("\n"),
    takeaways: s.takeaways.join("\n"),
    blockers: s.blockers.join("\n"),
    open_questions: s.open_questions.join("\n"),
  };
}

export function fromEditable(e: EditableSummary, original: SummaryData): SummaryData {
  return {
    ...original,
    overview: e.overview.trim(),
    sections: original.sections.map((x) => ({ ...x, items: lines(e.sections[x.key] ?? "") })),
    decisions: lines(e.decisions).map((l) => {
      const [text, ...rest] = l.split(" | ");
      return { text: text.trim(), rationale: rest.join(" | ").trim() };
    }),
    action_items: lines(e.action_items).map((l) => {
      const [text, owner = "", due = ""] = l.split("|").map((p) => p.trim());
      return { text, owner: owner || null, due_date: due || null };
    }),
    takeaways: lines(e.takeaways),
    blockers: lines(e.blockers),
    open_questions: lines(e.open_questions),
  };
}
