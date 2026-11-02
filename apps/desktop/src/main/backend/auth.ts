// Sign-in. Supabase Auth with an emailed one-time code (the same email carries the magic link;
// typing the code avoids deep links into the desktop app). The Supabase session is traded for a
// short-lived backend token (POST /auth/session). A dev login exists only when the backend
// allows it (ALLOW_DEV_LOGIN=1 on localhost).

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
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

  private client(): SupabaseClient {
    const { supabaseUrl, supabaseAnonKey } = this.settings();
    if (!supabaseAnonKey) throw new Error("Add your Supabase URL and anon key in Settings first.");
    const key = `${supabaseUrl}|${supabaseAnonKey}`;
    if (!this.supabase || this.supabaseKey !== key) {
      const secrets = this.secrets;
      this.supabase = createClient(supabaseUrl, supabaseAnonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: false, // refreshed on demand when the backend token needs renewing
          detectSessionInUrl: false,
          // The Supabase session lives in the OS keychain, like every other secret.
          storage: {
            getItem: () => secrets.get(SUPABASE),
            setItem: (_k: string, v: string) => secrets.set(SUPABASE, v),
            removeItem: () => secrets.delete(SUPABASE),
          },
        },
      });
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

  async sendCode(email: string): Promise<void> {
    const { error } = await this.client().auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: true } });
    if (error) throw new Error(error.message);
  }

  async verifyCode(email: string, code: string): Promise<AuthState> {
    const { data, error } = await this.client().auth.verifyOtp({ email: email.trim(), token: code.trim(), type: "email" });
    if (error || !data.session) throw new Error(error?.message ?? "That code didn't work");
    return this.save(await this.backend.exchangeSupabase(data.session.access_token), "supabase");
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
        await this.client().auth.signOut({ scope: "local" });
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
        const { data, error } = await this.client().auth.refreshSession();
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
