import { describe, expect, it } from "vitest";
import type { MeetingEvent } from "@meeting-copilot/shared";
import { EMPTY_CAPTIONS, reduceCaptions, visibleLines, type CaptionState } from "./captions";

const base = { meeting_id: "m1", ts_ms: 0 };
let seq = 0;
const ev = (e: Record<string, unknown>) => ({ ...base, seq: ++seq, ...e }) as unknown as MeetingEvent;
const run = (events: MeetingEvent[], s: CaptionState = EMPTY_CAPTIONS) => events.reduce(reduceCaptions, s);

describe("captions", () => {
  it("replaces partials per speaker and turns them into finals", () => {
    const s = run([
      ev({ type: "transcript.partial", channel: "system", speaker_id: "spk_1", text: "so when", start_ms: 100 }),
      ev({ type: "transcript.partial", channel: "system", speaker_id: "spk_1", text: "so when is the", start_ms: 100 }),
      ev({ type: "transcript.partial", channel: "mic", speaker_id: "me", text: "um", start_ms: 900 }),
    ]);
    expect(visibleLines(s).map((l) => [l.speaker, l.text, l.final])).toEqual([
      ["Speaker 2", "so when is the", false],
      ["You", "um", false],
    ]);
    const done = run([ev({ type: "transcript.final", segment_id: "seg_1", channel: "system", speaker_id: "spk_1",
      text: "So when is the deploy?", start_ms: 100, end_ms: 1800 })], s);
    expect(visibleLines(done).map((l) => [l.speaker, l.text, l.final])).toEqual([
      ["Speaker 2", "So when is the deploy?", true],
      ["You", "um", false],
    ]);
  });

  it("orders finals by time and ignores replayed duplicates", () => {
    const final = (id: string, start: number) =>
      ev({ type: "transcript.final", segment_id: id, channel: "mic", speaker_id: "me", text: id, start_ms: start, end_ms: start + 1 });
    const s = run([final("seg_2", 2000), final("seg_1", 1000), final("seg_2", 2000)]);
    expect(s.finals.map((l) => l.key)).toEqual(["seg_1", "seg_2"]);
  });

  it("tracks the transcription provider and resets for a new meeting", () => {
    let s = run([
      ev({ type: "meeting.started", mode: "cloud", providers: { "stt_live.system": "deepgram/nova-3" } }),
      ev({ type: "transcript.final", segment_id: "seg_1", channel: "mic", speaker_id: "me", text: "hi", start_ms: 0, end_ms: 1 }),
      ev({ type: "provider.switched", task: "stt_live", from: "deepgram/nova-3", to: "groq/whisper-large-v3", reason: "x" }),
    ]);
    expect(s.provider).toBe("groq/whisper-large-v3");
    s = reduceCaptions(s, { ...ev({ type: "meeting.started", mode: "cloud", providers: {} }), meeting_id: "m2" } as MeetingEvent);
    expect(s.finals).toEqual([]);
    expect(s.meetingId).toBe("m2");
  });
});
