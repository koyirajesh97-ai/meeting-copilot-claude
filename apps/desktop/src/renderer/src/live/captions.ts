// Caption state from live meeting events. Pure, so it's unit-tested.
// Partials are replaced per speaker; a final replaces its speaker's partial and is kept.

import type { MeetingEvent } from "@meeting-copilot/shared";
import { speakerLabel } from "../../../shared/ipc";

export interface CaptionLine {
  key: string;
  speakerId: string;
  speaker: string;
  channel: "mic" | "system";
  text: string;
  final: boolean;
  startMs: number;
}

export interface CaptionState {
  meetingId: string | null;
  finals: CaptionLine[];
  partials: Record<string, CaptionLine>;
  provider: string | null;
  /** Recognized enrolled speakers: "spk_1" -> "Priya". */
  names: Record<string, string>;
}

export const EMPTY_CAPTIONS: CaptionState = { meetingId: null, finals: [], partials: {}, provider: null, names: {} };
export const MAX_LINES = 300;

export function reduceCaptions(state: CaptionState, event: MeetingEvent): CaptionState {
  if (state.meetingId !== event.meeting_id) state = { ...EMPTY_CAPTIONS, meetingId: event.meeting_id };
  switch (event.type) {
    case "meeting.started": {
      const p = event.providers["stt_live.system"] ?? event.providers["stt_live.mic"] ?? null;
      return { ...state, provider: p };
    }
    case "speaker.identified": {
      const names = { ...state.names, [event.speaker_id]: event.display_name };
      const rename = (l: CaptionLine) => (l.speakerId === event.speaker_id ? { ...l, speaker: event.display_name } : l);
      return {
        ...state,
        names,
        finals: state.finals.map(rename),
        partials: Object.fromEntries(Object.entries(state.partials).map(([k, l]) => [k, rename(l)])),
      };
    }
    case "provider.switched":
      return event.task === "stt_live" ? { ...state, provider: event.to } : state;
    case "transcript.partial": {
      const key = `${event.channel}:${event.speaker_id}`;
      const line: CaptionLine = {
        key: `partial:${key}`, speakerId: event.speaker_id, speaker: speakerLabel(event.speaker_id, state.names),
        channel: event.channel, text: event.text, final: false, startMs: event.start_ms,
      };
      return { ...state, partials: { ...state.partials, [key]: line } };
    }
    case "transcript.final": {
      if (state.finals.some((l) => l.key === event.segment_id)) return state; // replayed
      const key = `${event.channel}:${event.speaker_id}`;
      const partials = { ...state.partials };
      delete partials[key];
      const line: CaptionLine = {
        key: event.segment_id, speakerId: event.speaker_id, speaker: speakerLabel(event.speaker_id, state.names),
        channel: event.channel, text: event.text, final: true, startMs: event.start_ms,
      };
      const finals = [...state.finals, line].sort((a, b) => a.startMs - b.startMs).slice(-MAX_LINES);
      return { ...state, finals, partials };
    }
    default:
      return state;
  }
}

/** Finals in time order, then in-progress partials. */
export function visibleLines(state: CaptionState): CaptionLine[] {
  return [...state.finals, ...Object.values(state.partials).sort((a, b) => a.startMs - b.startMs)];
}
