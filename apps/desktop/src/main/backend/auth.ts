// Sign-in. Supabase Auth with an emailed one-time code (the same email carries the magic link;
// typing the code avoids deep links into the desktop app). The Supabase session is traded for a
// short-lived backend token (POST /auth/session). A dev login exists only when the backend
// allows it (ALLOW_DEV_LOGIN=1 on localhost).

import type { SupabaseClient, SupportedStorage } from "@supabase/supabase-js";
import { EventEmitter } from "node:events";
import type { AuthState, Settings } from "../../shared/ipc";
import type { BackendClient, SessionOut } from "./client";

export interface SecretBox {
  get(name: string): string | null;
  set(name: string, value: string): void;
  delete(name: string): void;
}

interface StoredSession {
  token: string;
  expires_at: number;
  email: string | null;
  kind: "supabase" | "dev";
}

const BACKEND = "backendToken";
const SUPABASE = "supabaseSession";
const REFRESH_MARGIN_S = 120;

export const SIGNED_OUT: AuthState = { signedIn: false, email: null, kind: null };

/** Sign-in methods the Supabase project has turned on (shown on the sign-in screen). */
export interface AuthProviders {
  google: boolean;
}

export const MIN_PASSWORD_LENGTH = 8;

/**
 * Supabase keeps several values (the session, and during Google sign-in a PKCE verifier) under
 * different keys; the keychain has one slot for them, so they live there as a small JSON map.
 * A value stored by older versions (the session itself) is still read for the session key.
 */
export function slotStorage(secrets: SecretBox, slot: string): SupportedStorage {
  type Map = { v: 1; items: Record<string, string> };
  const read = (): Map => {
    const raw = secrets.get(slot);
    if (!raw) return { v: 1, items: {} };
    try {
      const parsed = JSON.parse(raw) as Partial<Map>;
      if (parsed && parsed.v === 1 && parsed.items) return parsed as Map;
    } catch {
      /* not ours */
    }
    return { v: 1, items: { "*legacy*": raw } };
  };
  const write = (m: Map) => (Object.keys(m.items).length ? secrets.set(slot, JSON.stringify(m)) : secrets.delete(slot));
  return {
    getItem: (key) => {
      const m = read();
      return m.items[key] ?? (key.endsWith("-auth-token") ? (m.items["*legacy*"] ?? null) : null);
    },
    setItem: (key, value) => {
      const m = read();
      delete m.items["*legacy*"];
      m.items[key] = value;
      write(m);
    },
    removeItem: (key) => {
      const m = read();
      delete m.items[key];
      if (key.endsWith("-auth-token")) delete m.items["*legacy*"];
      write(m);
    },
  };
}

/** Supabase's error text, made friendlier where it's cryptic. */
function friendly(message: string): string {
  if (/invalid login credentials/i.test(message)) return "Wrong email or password.";
  if (/email not confirmed/i.test(message)) return "Confirm your email first: enter the code we sent you (or use \"Email me a code\").";
  if (/user already registered/i.test(message)) return "There's already an account with that email. Sign in instead.";
  if (/provider is not enabled/i.test(message)) return "Google sign-in isn't turned on for this app yet.";
  return message;
}

export class AuthManager extends EventEmitter<{ change: [AuthState] }> {
  private session: StoredSession | null = null;
  private supabase: SupabaseClient | null = null;
  private supabaseKey = "";
  private refreshing: Promise<string | null> | null = null;

  constructor(
    private readonly backend: BackendClient,
    private readonly settings: () => Settings,
    private readonly secrets: SecretBox,
    private readonly now: () => number = () => Date.now() / 1000,
    /** Tests pass a fake Supabase client. */
    private readonly makeClient: (url: string, key: string, storage: SupportedStorage) => SupabaseClient | Promise<SupabaseClient> = async (url, key, storage) =>
      // Loaded on first use: the web app's first screen doesn't need it once you're signed in.
      (await import("@supabase/supabase-js")).createClient(url, key, {
        auth: {
          persistSession: true,
          autoRefreshToken: false, // refreshed on demand when the backend token needs renewing
          detectSessionInUrl: false,
          flowType: "pkce", // Google sign-in comes back with ?code=, exchanged below
          storage,
        },
      }),
  ) {
    super();
    const raw = secrets.get(BACKEND);
    if (raw) {
      try {
        this.session = JSON.parse(raw) as StoredSession;
      } catch {
        secrets.delete(BACKEND);
      }
    }
  }

  get state(): AuthState {
    return this.session ? { signedIn: true, email: this.session.email, kind: this.session.kind } : SIGNED_OUT;
  }

  private async client(): Promise<SupabaseClient> {
    const { supabaseUrl, supabaseAnonKey } = this.settings();
    if (!supabaseAnonKey) throw new Error("Add your Supabase URL and anon key in Settings first.");
    const key = `${supabaseUrl}|${supabaseAnonKey}`;
    if (!this.supabase || this.supabaseKey !== key) {
      // The Supabase session lives in the OS keychain (desktop) or local storage (web).
      this.supabase = await this.makeClient(supabaseUrl, supabaseAnonKey, slotStorage(this.secrets, SUPABASE));
      this.supabaseKey = key;
    }
    return this.supabase;
  }

  private save(out: SessionOut, kind: StoredSession["kind"]): AuthState {
    this.session = { token: out.token, expires_at: out.expires_at, email: out.email, kind };
    this.secrets.set(BACKEND, JSON.stringify(this.session));
    this.emit("change", this.state);
    return this.state;
  }

  private async fromSupabase(accessToken: string): Promise<AuthState> {
    return this.save(await this.backend.exchangeSupabase(accessToken), "supabase");
  }

  /** Email and password. */
  async signIn(email: string, password: string): Promise<AuthState> {
    const { data, error } = await (await this.client()).auth.signInWithPassword({ email: email.trim(), password });
    if (error || !data.session) throw new Error(friendly(error?.message ?? "Sign-in failed"));
    return this.fromSupabase(data.session.access_token);
  }

  /** New account. Returns needsConfirmation when Supabase emails a code to confirm the address first. */
  async signUp(email: string, password: string): Promise<{ needsConfirmation: boolean; state: AuthState }> {
    if (password.length < MIN_PASSWORD_LENGTH) throw new Error(`Use at least ${MIN_PASSWORD_LENGTH} characters for the password.`);
    const { data, error } = await (await this.client()).auth.signUp({ email: email.trim(), password });
    if (error) throw new Error(friendly(error.message));
    // An existing, confirmed address comes back with no identities (Supabase hides that it exists).
    if (data.user && data.user.identities?.length === 0) throw new Error(friendly("User already registered"));
    if (data.session) return { needsConfirmation: false, state: await this.fromSupabase(data.session.access_token) };
    return { needsConfirmation: true, state: this.state };
  }

  /** Change (or set a first) password while signed in. */
  async setPassword(password: string): Promise<void> {
    if (password.length < MIN_PASSWORD_LENGTH) throw new Error(`Use at least ${MIN_PASSWORD_LENGTH} characters for the password.`);
    if (this.session?.kind !== "supabase") throw new Error("Sign in with your email first.");
    const { error } = await (await this.client()).auth.updateUser({ password });
    if (error) throw new Error(friendly(error.message));
  }

  /** Which sign-in buttons to show: read from the Supabase project's public settings. */
  async providers(fetchImpl: typeof fetch = (i, o) => fetch(i, o)): Promise<AuthProviders> {
    const { supabaseUrl, supabaseAnonKey } = this.settings();
    if (!supabaseAnonKey) return { google: false };
    try {
      const res = await fetchImpl(`${supabaseUrl.replace(/\/+$/, "")}/auth/v1/settings`, {
        headers: { apikey: supabaseAnonKey },
        signal: AbortSignal.timeout(5000),
      });
      const body = (await res.json()) as { external?: { google?: boolean } };
      return { google: body.external?.google === true };
    } catch {
      return { google: false };
    }
  }

  /** The Google sign-in page; afterwards Google sends the browser back to `redirectTo` with ?code=. */
  async googleUrl(redirectTo: string): Promise<string> {
    const { data, error } = await (await this.client()).auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo, skipBrowserRedirect: true },
    });
    if (error || !data.url) throw new Error(friendly(error?.message ?? "Google sign-in isn't available"));
    return data.url;
  }

  /** Finish Google sign-in with the ?code= it returned. */
  async completeOAuth(code: string): Promise<AuthState> {
    const { data, error } = await (await this.client()).auth.exchangeCodeForSession(code);
    if (error || !data.session) throw new Error(friendly(error?.message ?? "Google sign-in didn't finish"));
    return this.fromSupabase(data.session.access_token);
  }

  async sendCode(email: string): Promise<void> {
    const { error } = await (await this.client()).auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: true } });
    if (error) throw new Error(error.message);
  }

  async verifyCode(email: string, code: string): Promise<AuthState> {
    // "email" covers sign-in codes; a new account's confirmation code is type "signup".
    let { data, error } = await (await this.client()).auth.verifyOtp({ email: email.trim(), token: code.trim(), type: "email" });
    if (error || !data.session) {
      const retry = await (await this.client()).auth.verifyOtp({ email: email.trim(), token: code.trim(), type: "signup" });
      if (retry.data.session) ({ data, error } = retry);
    }
    if (error || !data.session) throw new Error(friendly(error?.message ?? "That code didn't work"));
    return this.fromSupabase(data.session.access_token);
  }

  async devAvailable(): Promise<boolean> {
    try {
      return (await this.backend.health()).dev_login;
    } catch {
      return false;
    }
  }

  async devSignIn(): Promise<AuthState> {
    return this.save(await this.backend.devSession(), "dev");
  }

  async signOut(): Promise<AuthState> {
    if (this.session?.kind === "supabase") {
      try {
        await (await this.client()).auth.signOut({ scope: "local" });
      } catch {
        /* offline: forget locally anyway */
      }
    }
    this.session = null;
    this.secrets.delete(BACKEND);
    this.secrets.delete(SUPABASE);
    this.emit("change", this.state);
    return this.state;
  }

  /** A valid backend token, renewed shortly before it expires. Null when signed out. */
  async token(): Promise<string | null> {
    const s = this.session;
    if (!s) return null;
    if (s.expires_at - REFRESH_MARGIN_S > this.now()) return s.token;
    this.refreshing ??= this.renew().finally(() => (this.refreshing = null));
    return this.refreshing;
  }

  private async renew(): Promise<string | null> {
    const s = this.session;
    if (!s) return null;
    try {
      let out: SessionOut;
      if (s.kind === "dev") {
        out = await this.backend.devSession();
      } else {
        const { data, error } = await (await this.client()).auth.refreshSession();
        if (error || !data.session) throw new Error(error?.message ?? "session expired");
        out = await this.backend.exchangeSupabase(data.session.access_token);
      }
      this.save(out, s.kind);
      return out.token;
    } catch (err) {
      console.warn("[auth] couldn't renew the backend token:", (err as Error).message);
      // Keep the old token while offline; it may still work, and sign-in state shouldn't flicker.
      return s.expires_at > this.now() ? s.token : null;
    }
  }
}
