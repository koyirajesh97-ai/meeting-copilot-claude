// The backend REST API as the phone uses it. Same routes and token as the desktop app; no
// provider keys ever live on the phone.

import type { MeetingApi, MeetingSocket, SessionTools } from "@meeting-copilot/shared";

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export interface StartOptions {
  title: string;
  type: string;
  mode: "cloud" | "live-only";
  visibility: "private" | "project";
  project_id: string | null;
  agenda?: string;
  /** The session's adaptive tools; sent over the live socket, not to the meeting record. */
  tools?: SessionTools;
}

export interface SessionOut {
  token: string;
  expires_at: number;
  email: string | null;
}

export interface MeetingSummary {
  id: string;
  title: string;
  type: string;
  started_at: number;
  ended_at: number | null;
  is_mine?: boolean;
}

export interface Segment {
  segment_id: string;
  speaker_id: string;
  text: string;
  start_ms: number;
}

export interface MeetingDetail extends MeetingSummary {
  transcript: Segment[];
  summary: { status: string; data: Record<string, unknown> | null };
  action_items: { id: string; text: string; owner: string | null; due: string | null; status: string }[];
  speaker_names: Record<string, string>;
}

export interface SearchHit {
  meeting_id: string;
  title: string;
  text: string;
  start_ms: number | null;
  document_id?: string | null;
}

export interface Project {
  id: string;
  name: string;
  role: string;
}

type Fetch = typeof fetch;

export class Api implements MeetingApi<StartOptions> {
  constructor(
    readonly baseUrl: () => string,
    private readonly token: () => Promise<string | null>,
    private readonly fetchImpl: Fetch = (...a) => fetch(...a),
  ) {}

  async request<T>(method: string, path: string, body?: unknown, auth = true): Promise<T> {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (auth) {
      const t = await this.token();
      if (!t) throw new ApiError("Not signed in", 401);
      headers.Authorization = `Bearer ${t}`;
    }
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl().replace(/\/$/, "")}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (err) {
      throw new ApiError(`Can't reach the backend: ${(err as Error).message}`, 0);
    }
    if (!res.ok) {
      let detail = res.statusText;
      try {
        const j = (await res.json()) as { detail?: unknown };
        if (typeof j.detail === "string") detail = j.detail;
      } catch {
        /* not JSON */
      }
      throw new ApiError(`${res.status} ${detail}`, res.status);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  health() {
    return this.request<{ status: string; dev_login: boolean }>("GET", "/health", undefined, false);
  }
  exchangeSupabase(accessToken: string) {
    return this.request<SessionOut>("POST", "/auth/session", { access_token: accessToken }, false);
  }
  devSession() {
    return this.request<SessionOut>("POST", "/auth/dev-session", undefined, false);
  }
  createMeeting(o: StartOptions): Promise<MeetingSocket> {
    // Tools go over the live socket, not into the meeting record.
    const meeting: Partial<StartOptions> = { ...o };
    delete meeting.tools;
    return this.request("POST", "/meetings", meeting);
  }
  wsToken(id: string): Promise<MeetingSocket> {
    return this.request("POST", `/meetings/${encodeURIComponent(id)}/ws-token`);
  }
  endMeeting(id: string): Promise<void> {
    return this.request("POST", `/meetings/${encodeURIComponent(id)}/end`);
  }
  meetings() {
    return this.request<MeetingSummary[]>("GET", "/meetings");
  }
  meeting(id: string) {
    return this.request<MeetingDetail>("GET", `/meetings/${encodeURIComponent(id)}`);
  }
  search(q: string) {
    return this.request<SearchHit[]>("GET", `/search?q=${encodeURIComponent(q)}`);
  }
  projects() {
    return this.request<Project[]>("GET", "/projects");
  }
}
