// REST calls to the backend. The token comes from the auth manager; API keys never live here.

import type { ActionItem, AskAnswer, EnrolledVoice, CachedSegment, SearchHit, StartOptions, SummaryData, SummaryInfo } from "../../shared/ipc";

export class BackendError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export interface MeetingSocket {
  meeting_id: string;
  ws_url: string;
  ws_token: string;
}

export interface MeetingOut {
  id: string;
  type: string;
  title: string;
  mode: string;
  visibility: string;
  started_at: number;
  ended_at: number | null;
}

export interface MeetingDetailOut extends MeetingOut {
  transcript: CachedSegment[];
  summary: SummaryInfo;
  action_items: ActionItem[];
  decisions: { id: string; text: string; rationale: string }[];
  speaker_names: Record<string, string>;
}

export interface SessionOut {
  token: string;
  expires_at: number;
  user_id: string;
  email: string | null;
}

export class BackendClient {
  constructor(
    private readonly baseUrl: () => string,
    private readonly token: () => Promise<string | null>,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async request<T>(method: string, path: string, body?: unknown, opts: { auth?: boolean; timeoutMs?: number } = {}): Promise<T> {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (opts.auth !== false) {
      const t = await this.token();
      if (!t) throw new BackendError("Not signed in", 401);
      headers.Authorization = `Bearer ${t}`;
    }
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl()}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(opts.timeoutMs ?? 10_000),
      });
    } catch (err) {
      throw new BackendError(`Backend unreachable: ${(err as Error).message}`, 0);
    }
    if (!res.ok) {
      let detail = res.statusText;
      try {
        detail = ((await res.json()) as { detail?: string }).detail ?? detail;
      } catch {
        /* not JSON */
      }
      throw new BackendError(`${method} ${path}: ${res.status} ${detail}`, res.status);
    }
    if (res.status === 204) return undefined as T;
    const type = res.headers.get("content-type") ?? "";
    return (type.includes("json") ? await res.json() : await res.text()) as T;
  }

  health(): Promise<{ status: string; dev_login: boolean }> {
    return this.request("GET", "/health", undefined, { auth: false, timeoutMs: 3000 });
  }

  exchangeSupabase(accessToken: string): Promise<SessionOut> {
    return this.request("POST", "/auth/session", { access_token: accessToken }, { auth: false });
  }

  devSession(): Promise<SessionOut> {
    return this.request("POST", "/auth/dev-session", undefined, { auth: false });
  }

  createMeeting(opts: StartOptions): Promise<MeetingSocket> {
    return this.request("POST", "/meetings", opts);
  }

  wsToken(meetingId: string): Promise<MeetingSocket> {
    return this.request("POST", `/meetings/${encodeURIComponent(meetingId)}/ws-token`);
  }

  endMeeting(meetingId: string): Promise<void> {
    return this.request("POST", `/meetings/${encodeURIComponent(meetingId)}/end`);
  }

  listMeetings(): Promise<MeetingOut[]> {
    return this.request("GET", "/meetings");
  }

  getMeeting(meetingId: string): Promise<MeetingDetailOut> {
    return this.request("GET", `/meetings/${encodeURIComponent(meetingId)}`);
  }

  async enrollVoice(wav: Buffer, displayName: string, consent: boolean): Promise<EnrolledVoice> {
    const t = await this.token();
    if (!t) throw new BackendError("Not signed in", 401);
    const form = new FormData();
    form.set("consent", consent ? "true" : "false");
    form.set("display_name", displayName);
    form.set("audio", new Blob([new Uint8Array(wav)], { type: "audio/wav" }), "voice.wav");
    const res = await this.fetchImpl(`${this.baseUrl()}/speakers/enroll`, {
      method: "POST",
      headers: { Authorization: `Bearer ${t}` },
      body: form,
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      const detail = await res.json().then(
        (j) => (j as { detail?: string }).detail ?? res.statusText,
        () => res.statusText,
      );
      throw new BackendError(`Enrollment failed: ${res.status} ${detail}`, res.status);
    }
    return (await res.json()) as EnrolledVoice;
  }

  listVoices(): Promise<EnrolledVoice[]> {
    return this.request("GET", "/speakers");
  }

  deleteVoice(id: string): Promise<void> {
    return this.request("DELETE", `/speakers/${encodeURIComponent(id)}`);
  }

  search(q: string): Promise<SearchHit[]> {
    return this.request("GET", `/search?q=${encodeURIComponent(q)}&limit=20`);
  }

  ask(question: string): Promise<AskAnswer> {
    return this.request("POST", "/ask", { question }, { timeoutMs: 30_000 });
  }

  getSummary(meetingId: string): Promise<SummaryInfo> {
    return this.request("GET", `/meetings/${encodeURIComponent(meetingId)}/summary`);
  }

  regenerate(meetingId: string, template: string): Promise<SummaryInfo> {
    return this.request("POST", `/meetings/${encodeURIComponent(meetingId)}/summary/regenerate`, { template });
  }

  saveSummary(meetingId: string, data: SummaryData): Promise<SummaryInfo> {
    return this.request("PUT", `/meetings/${encodeURIComponent(meetingId)}/summary`, { data });
  }

  renameSpeaker(meetingId: string, label: string, name: string): Promise<void> {
    return this.request(
      "POST",
      `/meetings/${encodeURIComponent(meetingId)}/speakers/${encodeURIComponent(label)}/rename`,
      { display_name: name },
    );
  }

  markdown(meetingId: string, withTranscript: boolean): Promise<string> {
    return this.request("GET", `/meetings/${encodeURIComponent(meetingId)}/export?format=md&transcript=${withTranscript}`);
  }
}
