// Card stack state from live events. Pure, so it's unit-tested.
// Priority: answers to you, then your standup script, then everything else. At most two show;
// the rest wait. Cards collapse after 45 s unless pinned.

import type { MeetingEvent, Source } from "@meeting-copilot/shared";

export interface Card {
  id: string;
  kind: string;
  text: string;
  sources: Source[];
  confidence: number;
  provider: string;
  createdAt: number;
  pinned: boolean;
  dismissed: boolean;
  feedback: boolean | null;
}

export interface CardState {
  meetingId: string | null;
  cards: Card[];
}

export const EMPTY_CARDS: CardState = { meetingId: null, cards: [] };
export const MAX_VISIBLE = 2;
export const COLLAPSE_AFTER_MS = 45_000;
const PRIORITY: Record<string, number> = { answer: 0, standup: 1 };

export type CardAction =
  | { type: "event"; event: MeetingEvent; now: number }
  | { type: "pin"; id: string }
  | { type: "dismiss"; id: string }
  | { type: "feedback"; id: string; useful: boolean };

export function reduceCards(state: CardState, a: CardAction): CardState {
  const update = (id: string, patch: Partial<Card>) => ({
    ...state,
    cards: state.cards.map((c) => (c.id === id ? { ...c, ...patch } : c)),
  });
  switch (a.type) {
    case "pin":
      return update(a.id, { pinned: !state.cards.find((c) => c.id === a.id)?.pinned });
    case "dismiss":
      return update(a.id, { dismissed: true });
    case "feedback":
      return update(a.id, { feedback: a.useful });
    case "event": {
      const e = a.event;
      if (state.meetingId !== e.meeting_id) state = { ...EMPTY_CARDS, meetingId: e.meeting_id };
      if (e.type === "card.created") {
        if (state.cards.some((c) => c.id === e.card_id)) return state; // replayed
        const card: Card = {
          id: e.card_id, kind: e.kind, text: e.text, sources: e.sources, confidence: e.confidence,
          provider: e.provider, createdAt: a.now, pinned: false, dismissed: false, feedback: null,
        };
        return { ...state, cards: [...state.cards, card] };
      }
      if (e.type === "card.delta") {
        const c = state.cards.find((x) => x.id === e.card_id);
        if (!c || c.text.endsWith(e.text)) return state;
        return update(e.card_id, {
          text: c.text + e.text,
          sources: [...c.sources, ...(e.sources ?? [])],
          confidence: e.confidence ?? c.confidence,
        });
      }
      return state;
    }
  }
}

/** Cards to show (in priority, then newest first), how many wait, and which are collapsed. */
export function visibleCards(state: CardState, now: number): { shown: (Card & { collapsed: boolean })[]; queued: number } {
  const active = state.cards
    .filter((c) => !c.dismissed)
    .sort((a, b) => (PRIORITY[a.kind] ?? 2) - (PRIORITY[b.kind] ?? 2) || b.createdAt - a.createdAt);
  return {
    shown: active.slice(0, MAX_VISIBLE).map((c) => ({ ...c, collapsed: !c.pinned && now - c.createdAt > COLLAPSE_AFTER_MS })),
    queued: Math.max(0, active.length - MAX_VISIBLE),
  };
}

export function sourceLabel(s: Source, currentMeetingId: string | null): string {
  const at = s.at_ms !== undefined && s.at_ms !== null ? ` at ${Math.floor(s.at_ms / 60000)}:${String(Math.floor((s.at_ms % 60000) / 1000)).padStart(2, "0")}` : "";
  if (s.type === "standup") return "Your standup notes";
  if (s.type === "transcript" || s.id === currentMeetingId) return `This meeting${at}`;
  if (s.type === "document") return "Project document";
  return `Past meeting${at}`;
}
