// Integrations calls from the renderer, mapped to backend routes here (the renderer never
// builds URLs), plus the 1-minute nudge before calendar meetings.

import type { IntegrationCall, UpcomingMeeting } from "../../shared/ipc";
import type { BackendClient } from "./client";

const KINDS = new Set(["google", "microsoft", "jira", "slack", "teams"]);
const kind = (k: unknown): string => {
  if (typeof k !== "string" || !KINDS.has(k)) throw new Error("Unknown integration");
  return k;
};
const id = (v: unknown): string => {
  if (typeof v !== "string" || !/^[\w-]{1,64}$/.test(v)) throw new Error("Bad id");
  return encodeURIComponent(v);
};
const target = (t: unknown): "slack" | "teams" => {
  if (t !== "slack" && t !== "teams") throw new Error("Post to Slack or Teams");
  return t;
};

export async function integrationCall(backend: BackendClient, call: IntegrationCall, openExternal: (url: string) => Promise<void>): Promise<unknown> {
  switch (call.op) {
    case "list":
      return backend.call("GET", "/integrations");
    case "save": {
      const body: Record<string, unknown> = { enabled: call.enabled === true };
      for (const f of ["site", "email", "api_token", "webhook_url"] as const) if (typeof call[f] === "string" && call[f]) body[f] = call[f];
      return backend.call("PUT", `/integrations/${kind(call.kind)}`, body);
    }
    case "remove":
      return backend.call("DELETE", `/integrations/${kind(call.kind)}`);
    case "connect": {
      const k = kind(call.kind);
      const { authorize_url } = await backend.call<{ authorize_url: string }>("POST", `/integrations/${k}/connect`);
      // Only the providers' own sign-in pages are opened.
      const host = new URL(authorize_url).hostname;
      if (host !== "accounts.google.com" && host !== "login.microsoftonline.com") throw new Error("Unexpected sign-in page");
      await openExternal(authorize_url);
      return null;
    }
    case "upcoming":
      return backend.call("GET", "/calendar/upcoming");
    case "tickets":
      return backend.call("GET", "/standup/tickets");
    case "preview":
      return backend.call("POST", `/meetings/${id(call.meetingId)}/share/preview`, { target: target(call.target) });
    case "post":
      return backend.call("POST", `/meetings/${id(call.meetingId)}/share`, {
        target: target(call.target),
        text: String(call.text).slice(0, 20_000),
        preview_token: String(call.previewToken),
      });
    default:
      throw new Error("Unknown integrations call");
  }
}

export const NUDGE_BEFORE_S = 60;

/**
 * Which events to nudge about now: starting within the next minute (or up to 30 s ago), not
 * nudged before, not already recorded. `nudged` is updated in place.
 */
export function dueNudges(events: UpcomingMeeting[], nudged: Set<string>, nowS: number): UpcomingMeeting[] {
  const due = events.filter((e) => !e.meeting_id && !nudged.has(e.id) && e.start - nowS <= NUDGE_BEFORE_S + 5 && e.start - nowS > -30);
  for (const e of due) nudged.add(e.id);
  return due;
}
