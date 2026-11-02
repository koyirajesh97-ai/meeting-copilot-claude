import { describe, expect, it } from "vitest";
import type { MeetingEvent } from "@meeting-copilot/shared";
import { COLLAPSE_AFTER_MS, EMPTY_CARDS, reduceCards, sourceLabel, visibleCards, type CardState } from "./cards";

let seq = 0;
const ev = (e: Record<string, unknown>) => ({ meeting_id: "m1", ts_ms: 0, seq: ++seq, ...e }) as unknown as MeetingEvent;
const created = (id: string, kind = "answer", extra = {}) =>
  ev({ type: "card.created", card_id: id, kind, text: `- ${id}`, sources: [{ type: "meeting", id: "m0", at_ms: 61000 }], confidence: 0.8, provider: "groq/x", ...extra });

function run(events: [MeetingEvent, number][], s: CardState = EMPTY_CARDS): CardState {
  return events.reduce((acc, [event, now]) => reduceCards(acc, { type: "event", event, now }), s);
}

describe("card stack", () => {
  it("streams deltas into a card and ignores replays", () => {
    let s = run([[created("c1"), 0], [ev({ type: "card.delta", card_id: "c1", text: "\n- more", sources: [{ type: "standup", id: "today" }] }), 1]]);
    s = run([[created("c1"), 2], [ev({ type: "card.delta", card_id: "c1", text: "\n- more" }), 3]], s);
    expect(s.cards).toHaveLength(1);
    expect(s.cards[0].text).toBe("- c1\n- more");
    expect(s.cards[0].sources.map((x) => x.type)).toEqual(["meeting", "standup"]);
  });

  it("shows answers first, at most two, and queues the rest", () => {
    const s = run([[created("t1", "topic"), 0], [created("a1"), 1], [created("t2", "topic"), 2], [created("s1", "standup"), 3]]);
    const { shown, queued } = visibleCards(s, 10);
    expect(shown.map((c) => c.id)).toEqual(["a1", "s1"]);
    expect(queued).toBe(2);
  });

  it("collapses after 45 s unless pinned; dismissed cards make room", () => {
    let s = run([[created("a1"), 0], [created("a2"), 0]]);
    s = reduceCards(s, { type: "pin", id: "a1" });
    const later = visibleCards(s, COLLAPSE_AFTER_MS + 1).shown;
    expect(later.map((c) => [c.id, c.collapsed])).toEqual(expect.arrayContaining([["a1", false], ["a2", true]]));
    s = reduceCards(s, { type: "dismiss", id: "a2" });
    s = reduceCards(s, { type: "feedback", id: "a1", useful: true });
    expect(visibleCards(s, 0).shown.map((c) => [c.id, c.feedback])).toEqual([["a1", true]]);
  });

  it("labels sources", () => {
    expect(sourceLabel({ type: "meeting", id: "m0", at_ms: 61000 }, "m1")).toBe("Past meeting at 1:01");
    expect(sourceLabel({ type: "transcript", id: "m1", at_ms: 0 }, "m1")).toBe("This meeting at 0:00");
    expect(sourceLabel({ type: "standup", id: "today" }, "m1")).toBe("Your standup notes");
  });

  it("starts fresh for a new meeting", () => {
    const s = run([[created("a1"), 0], [{ ...created("b1"), meeting_id: "m2" } as MeetingEvent, 1]]);
    expect(s.cards.map((c) => c.id)).toEqual(["b1"]);
  });
});
