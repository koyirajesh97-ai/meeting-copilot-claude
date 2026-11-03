// Meeting types, modes and the consent message, from the PRD.

export const MEETING_TYPES = [
  { id: "standup", label: "Standup" },
  { id: "review", label: "Sprint, code or design review" },
  { id: "planning", label: "Planning or refinement" },
  { id: "incident", label: "Incident or war room" },
  { id: "client", label: "Client or business meeting" },
  { id: "one_on_one", label: "One-on-one or personal" },
  { id: "research", label: "Research or learning session" },
  { id: "custom", label: "Custom" },
] as const;
export type MeetingType = (typeof MEETING_TYPES)[number]["id"];

export const MEETING_MODES = [
  { id: "cloud", label: "Cloud", hint: "Transcribed and summarized by free cloud AI services" },
  { id: "live-only", label: "Live-only", hint: "Help during the call; nothing is saved" },
  { id: "local", label: "Local-only", hint: "Nothing leaves this laptop" },
] as const;
export type MeetingMode = (typeof MEETING_MODES)[number]["id"];

export type Visibility = "private" | "project";

export const DEFAULT_CONSENT_MESSAGE =
  "Heads up: I'm recording and transcribing this meeting for my notes. " +
  "Let me know if you'd rather I didn't, and I'll pause it.";
