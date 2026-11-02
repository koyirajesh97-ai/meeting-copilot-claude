import Ajv2020 from "ajv/dist/2020";
import { describe, expect, it } from "vitest";
import examples from "../schema/examples.json";
import schema from "../schema/events.json";
import { EVENT_TYPES, type CardCreated, type ClientMessage, type MeetingEvent, type ProviderSwitched } from "./events";

const ajv = new Ajv2020({ allErrors: true, strict: true });
// Our own keyword listing client->server messages; not a validation rule.
ajv.addKeyword({ keyword: "x-client-messages", schemaType: "array" });
const validate = ajv.compile(schema);
const validateClient = ajv.compile({ oneOf: schema["x-client-messages"], $defs: schema.$defs });

function errors(): string {
  return ajv.errorsText(validate.errors);
}

describe("events schema", () => {
  it("has an example for every event type", () => {
    const covered = new Set(examples.map((e) => e.type));
    expect([...covered].sort()).toEqual([...EVENT_TYPES].sort());
  });

  it.each(examples.map((e) => [e.type, e] as const))("%s example is valid and round-trips", (_t, example) => {
    expect(validate(example), errors()).toBe(true);
    const event = JSON.parse(JSON.stringify(example)) as MeetingEvent;
    expect(event).toEqual(example);
    expect(validate(event), errors()).toBe(true);
  });

  it("accepts the PRD's card.created example built with the generated type", () => {
    const card: CardCreated = {
      type: "card.created",
      seq: 412,
      meeting_id: "m_123",
      ts_ms: 1830455123000,
      card_id: "c_88",
      kind: "answer",
      text: "- Prod deploy moved to Thursday after the cert renewal\n- Rollback plan is in the runbook",
      sources: [{ type: "meeting", id: "m_101", at_ms: 734000 }],
      confidence: 0.82,
      provider: "groq/gpt-oss-20b",
    };
    expect(validate(JSON.parse(JSON.stringify(card))), errors()).toBe(true);
  });

  it("keeps 'from' as the wire name for provider.switched", () => {
    const e: ProviderSwitched = {
      type: "provider.switched", seq: 1, meeting_id: "m", ts_ms: 0,
      task: "card", from: "groq/a", to: "mistral/b", reason: "429",
    };
    expect(validate(e), errors()).toBe(true);
  });

  it.each([
    ["missing seq", { type: "summary.ready", meeting_id: "m", ts_ms: 0, summary_id: "s" }],
    ["unknown type", { type: "nope", seq: 0, meeting_id: "m", ts_ms: 0 }],
    ["bad channel", { type: "transcript.partial", seq: 0, meeting_id: "m", ts_ms: 0, channel: "phone", speaker_id: "me", text: "", start_ms: 0 }],
    ["negative seq", { type: "summary.ready", seq: -1, meeting_id: "m", ts_ms: 0, summary_id: "s" }],
    ["confidence above 1", { type: "speaker.identified", seq: 0, meeting_id: "m", ts_ms: 0, speaker_id: "s", display_name: "A", confidence: 1.2 }],
  ])("rejects an event with %s", (_why, bad) => {
    expect(validate(bad)).toBe(false);
  });

  it("validates client messages", () => {
    const ok: ClientMessage[] = [
      { type: "ping" },
      { type: "control", action: "pause" },
      { type: "control", action: "catch_up", minutes: 5 },
      { type: "control", action: "card_feedback", card_id: "c_1", useful: true },
    ];
    for (const m of ok) expect(validateClient(m), ajv.errorsText(validateClient.errors)).toBe(true);
    expect(validateClient({ type: "control", action: "explode" })).toBe(false);
    expect(validateClient({ type: "control", action: "catch_up", minutes: 99 })).toBe(false);
    expect(validateClient({ type: "control" })).toBe(false);
  });
});
