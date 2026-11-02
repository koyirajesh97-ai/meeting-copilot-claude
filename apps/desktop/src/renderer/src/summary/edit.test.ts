import { describe, expect, it } from "vitest";
import type { SummaryData } from "../../../shared/ipc";
import { fromEditable, toEditable } from "./edit";

const summary: SummaryData = {
  overview: "Short meeting.",
  sections: [{ key: "risks", title: "Risks", items: ["Cert expiry", "Load"] }],
  decisions: [{ text: "Keep retries at 3", rationale: "protect the bank API" }, { text: "Ship Thursday", rationale: "" }],
  takeaways: ["Metrics matter"],
  action_items: [
    { text: "Add metrics", owner: "Alex", due_date: "Friday" },
    { text: "Update runbook", owner: "Sai", due_date: null },
    { text: "Rename flag", owner: null, due_date: null },
  ],
  blockers: [],
  open_questions: ["Timeout case?"],
  per_person: [],
};

describe("summary editing", () => {
  it("round-trips without changes", () => {
    expect(fromEditable(toEditable(summary), summary)).toEqual(summary);
  });

  it("uses one line per item and text | owner | due for action items", () => {
    const e = toEditable(summary);
    expect(e.action_items.split("\n")).toEqual(["Add metrics | Alex | Friday", "Update runbook | Sai", "Rename flag"]);
    e.action_items += "\n  New item | Priya |  \n\n";
    e.sections.risks = "Only one risk";
    const back = fromEditable(e, summary);
    expect(back.action_items.at(-1)).toEqual({ text: "New item", owner: "Priya", due_date: null });
    expect(back.sections[0].items).toEqual(["Only one risk"]);
  });
});
