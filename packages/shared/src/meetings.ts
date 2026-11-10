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

/** What the copilot does in each mode (Start screen cards). */
export const MODE_INFO: Record<string, { name: string; blurb: string; perks: string[] }> = {
  standup: { name: "Standup", blurb: "Your update on cue, blockers captured.", perks: ["Your script when it's your turn", "Done / doing / blockers per person"] },
  review: { name: "Review", blurb: "Code, design or sprint reviews.", perks: ["Answers about systems you own", "Feedback and decisions logged"] },
  planning: { name: "Planning", blurb: "Refinement and roadmap calls.", perks: ["Scope, estimates and owners", "Open questions tracked"] },
  incident: { name: "Incident", blurb: "War rooms where every second counts.", perks: ["Timeline as it happens", "Runbook facts on demand"] },
  client: { name: "Client call", blurb: "Customers, partners, stakeholders.", perks: ["Commitments and next steps", "Jargon explained instantly"] },
  one_on_one: { name: "1:1", blurb: "Manager and peer conversations.", perks: ["Feedback and goals noted", "Private by default"] },
  research: { name: "Learning", blurb: "Talks, trainings, interviews to learn from.", perks: ["Key ideas and terms", "Catch up after any distraction"] },
  custom: { name: "Anything else", blurb: "A general meeting copilot.", perks: ["Live captions and answers", "Summary and action items"] },
};
