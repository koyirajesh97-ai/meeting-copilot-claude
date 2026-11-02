// REST calls to the backend. The token comes from the auth manager; API keys never live here.

import type { CachedSegment, StartOptions } from "../../shared/ipc";

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
    return (res.status === 204 ? undefined : await res.json()) as T;
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
}
