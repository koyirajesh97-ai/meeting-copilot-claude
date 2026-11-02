import { useEffect, useReducer } from "react";
import type { MeetingEvent } from "@meeting-copilot/shared";
import { EMPTY_CAPTIONS, reduceCaptions, type CaptionState } from "./captions";

export function useCaptions(): CaptionState {
  const [state, dispatch] = useReducer((s: CaptionState, e: MeetingEvent) => reduceCaptions(s, e), EMPTY_CAPTIONS);
  useEffect(() => window.copilot.onLive(dispatch), []);
  return state;
}
