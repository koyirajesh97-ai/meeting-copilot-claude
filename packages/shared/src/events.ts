// Generated from schema/events.json by scripts/gen-events.mjs. Do not edit.
// Run `pnpm -w gen:events` after changing the schema.

export type MeetingMode = "cloud" | "local" | "live-only";

/** mic is always the user; system is the meeting's audio. */
export type Channel = "mic" | "system";

export type CardKind = "answer" | "topic" | "clarify" | "catch_up" | "standup" | "follow_up";

export type SourceType = "meeting" | "document" | "standup" | "transcript";

export type ControlAction = "pause" | "resume" | "catch_up" | "clarify" | "follow_up" | "card_feedback";

/** Fields every event carries. */
export interface Envelope {
  /** Increases by one per event in a meeting; used to replay after a reconnect. */
  seq: number;
  meeting_id: string;
  /** Server time in Unix milliseconds. */
  ts_ms: number;
}

/** Where a card's fact came from. */
export interface Source {
  type: SourceType;
  id: string;
  /** Offset into a meeting, for meeting and transcript sources. */
  at_ms?: number;
}

/** The socket opened and the meeting is live. */
export interface MeetingStarted {
  type: "meeting.started";
  /** Increases by one per event in a meeting; used to replay after a reconnect. */
  seq: number;
  meeting_id: string;
  /** Server time in Unix milliseconds. */
  ts_ms: number;
  mode: MeetingMode;
  /** Active provider per task, e.g. {"stt_live": "deepgram/nova-3"}. */
  providers: Record<string, string>;
}

/** Interim words. Not stored. */
export interface TranscriptPartial {
  type: "transcript.partial";
  /** Increases by one per event in a meeting; used to replay after a reconnect. */
  seq: number;
  meeting_id: string;
  /** Server time in Unix milliseconds. */
  ts_ms: number;
  channel: Channel;
  speaker_id: string;
  text: string;
  start_ms: number;
}

/** A finished utterance. Stored. */
export interface TranscriptFinal {
  type: "transcript.final";
  /** Increases by one per event in a meeting; used to replay after a reconnect. */
  seq: number;
  meeting_id: string;
  /** Server time in Unix milliseconds. */
  ts_ms: number;
  segment_id: string;
  channel: Channel;
  speaker_id: string;
  text: string;
  start_ms: number;
  end_ms: number;
}

/** A voice matched an enrolled person. */
export interface SpeakerIdentified {
  type: "speaker.identified";
  /** Increases by one per event in a meeting; used to replay after a reconnect. */
  seq: number;
  meeting_id: string;
  /** Server time in Unix milliseconds. */
  ts_ms: number;
  speaker_id: string;
  display_name: string;
  confidence: number;
}

/** The question detector fired on a segment. */
export interface QuestionDetected {
  type: "question.detected";
  /** Increases by one per event in a meeting; used to replay after a reconnect. */
  seq: number;
  meeting_id: string;
  /** Server time in Unix milliseconds. */
  ts_ms: number;
  segment_id: string;
  addressed_to_me: boolean;
  topic: string;
}

/** A card starts. Later bullets arrive as card.delta. */
export interface CardCreated {
  type: "card.created";
  /** Increases by one per event in a meeting; used to replay after a reconnect. */
  seq: number;
  meeting_id: string;
  /** Server time in Unix milliseconds. */
  ts_ms: number;
  card_id: string;
  kind: CardKind;
  text: string;
  sources: Source[];
  confidence: number;
  provider: string;
}

/** More text for an existing card, appended to its text. */
export interface CardDelta {
  type: "card.delta";
  /** Increases by one per event in a meeting; used to replay after a reconnect. */
  seq: number;
  meeting_id: string;
  /** Server time in Unix milliseconds. */
  ts_ms: number;
  card_id: string;
  text: string;
  sources?: Source[];
  confidence?: number;
}

/** The router fell back to another provider. */
export interface ProviderSwitched {
  type: "provider.switched";
  /** Increases by one per event in a meeting; used to replay after a reconnect. */
  seq: number;
  meeting_id: string;
  /** Server time in Unix milliseconds. */
  ts_ms: number;
  task: string;
  from: string;
  to: string;
  reason: string;
}

/** A daily free quota passed 80%. */
export interface QuotaWarning {
  type: "quota.warning";
  /** Increases by one per event in a meeting; used to replay after a reconnect. */
  seq: number;
  meeting_id: string;
  /** Server time in Unix milliseconds. */
  ts_ms: number;
  provider: string;
  task: string;
  percent_used: number;
}

/** The summary is saved. */
export interface SummaryReady {
  type: "summary.ready";
  /** Increases by one per event in a meeting; used to replay after a reconnect. */
  seq: number;
  meeting_id: string;
  /** Server time in Unix milliseconds. */
  ts_ms: number;
  summary_id: string;
}

/** Something failed. */
export interface Error {
  type: "error";
  /** Increases by one per event in a meeting; used to replay after a reconnect. */
  seq: number;
  meeting_id: string;
  /** Server time in Unix milliseconds. */
  ts_ms: number;
  code: string;
  message: string;
  retryable: boolean;
}

/** Messages on the meeting WebSocket. `oneOf` lists server->client events; `x-client-messages` lists client->server messages. Run `pnpm -w gen:events` after editing. */
export type MeetingEvent =
  | MeetingStarted
  | TranscriptPartial
  | TranscriptFinal
  | SpeakerIdentified
  | QuestionDetected
  | CardCreated
  | CardDelta
  | ProviderSwitched
  | QuotaWarning
  | SummaryReady
  | Error;

export type MeetingEventType = MeetingEvent["type"];

export const EVENT_TYPES = [
  "meeting.started",
  "transcript.partial",
  "transcript.final",
  "speaker.identified",
  "question.detected",
  "card.created",
  "card.delta",
  "provider.switched",
  "quota.warning",
  "summary.ready",
  "error",
] as const satisfies readonly MeetingEventType[];

// ---------- client -> server ----------

/** A button or hotkey in the overlay. Extra fields depend on the action. */
export interface Control {
  type: "control";
  action: ControlAction;
  /** catch_up: how far back to recap (2 or 5). */
  minutes?: number;
  /** card_feedback: the card being rated. */
  card_id?: string;
  /** card_feedback: Used (true) or Not useful (false). */
  useful?: boolean;
}

/** Sent every 15 s so both sides know the socket is alive. */
export interface Ping {
  type: "ping";
}

/** Messages the client sends up the meeting WebSocket (besides binary audio frames). */
export type ClientMessage =
  | Control
  | Ping;
