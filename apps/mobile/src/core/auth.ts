// Sign-in on the phone: Supabase emailed code (or the local dev login), traded for a short-lived
// backend token. Sessions are kept in the OS keychain (expo-secure-store) via `KeyStore`.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Api, SessionOut } from "./api";

export interface KeyStore {
  get(name: string): Promise<string | null>;
  set(name: string, value: string): Promise<void>;
  delete(name: string): Promise<void>;
}

export interface Session extends SessionOut {
  kind: "supabase" | "dev";
}

const BACKEND = "backendToken";
const SUPABASE = "supabaseSession";
const MARGIN_S = 120;

export class Auth {
  private session: Session | null = null;
  private supabase: SupabaseClient | null = null;

  constructor(
    private readonly api: Api,
    private readonly store: KeyStore,
    private readonly supabaseConfig: () => { url: string; anonKey: string },
    private readonly now: () => number = () => Date.now() / 1000,
  ) {}

  async load(): Promise<Session | null> {
    const raw = await this.store.get(BACKEND);
    this.session = raw ? (JSON.parse(raw) as Session) : null;
    return this.session;
  }

  get current(): Session | null {
    return this.session;
  }

  private client(): SupabaseClient {
    const { url, anonKey } = this.supabaseConfig();
    if (!anonKey) throw new Error("Set the Supabase URL and anon key in Settings first.");
    const store = this.store;
    this.supabase ??= createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: false,
        detectSessionInUrl: false,
        storage: {
          getItem: () => store.get(SUPABASE),
          setItem: (_k: string, v: string) => store.set(SUPABASE, v),
          removeItem: () => store.delete(SUPABASE),
        },
      },
    });
    return this.supabase;
  }

  private async save(out: SessionOut, kind: Session["kind"]): Promise<Session> {
    this.session = { ...out, kind };
    await this.store.set(BACKEND, JSON.stringify(this.session));
    return this.session;
  }

  async sendCode(email: string): Promise<void> {
    const { error } = await this.client().auth.signInWithOtp({ email: email.trim() });
    if (error) throw new Error(error.message);
  }

  async verifyCode(email: string, code: string): Promise<Session> {
    const { data, error } = await this.client().auth.verifyOtp({ email: email.trim(), token: code.trim(), type: "email" });
    if (error || !data.session) throw new Error(error?.message ?? "That code didn't work");
    return this.save(await this.api.exchangeSupabase(data.session.access_token), "supabase");
  }

  async devSignIn(): Promise<Session> {
    return this.save(await this.api.devSession(), "dev");
  }

  /** A valid backend token, renewed shortly before it expires. */
  async token(): Promise<string | null> {
    const s = this.session;
    if (!s) return null;
    if (s.expires_at - MARGIN_S > this.now()) return s.token;
    try {
      if (s.kind === "dev") return (await this.devSignIn()).token;
      const { data, error } = await this.client().auth.refreshSession();
      if (error || !data.session) throw new Error(error?.message ?? "Session expired");
      return (await this.save(await this.api.exchangeSupabase(data.session.access_token), "supabase")).token;
    } catch {
      await this.signOut();
      return null;
    }
  }

  async signOut(): Promise<void> {
    this.session = null;
    await this.store.delete(BACKEND);
    await this.store.delete(SUPABASE);
  }
}
