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
export const MIN_PASSWORD_LENGTH = 8;

/** Supabase's error text, made friendlier where it's cryptic (same wording as the other apps). */
export function friendly(message: string): string {
  if (/invalid login credentials/i.test(message)) return "Wrong email or password.";
  if (/email not confirmed/i.test(message)) return "Confirm your email first: enter the code we sent you (or use \"Email me a code\").";
  if (/user already registered/i.test(message)) return "There's already an account with that email. Sign in instead.";
  return message;
}

export class Auth {
  private session: Session | null = null;
  private supabase: SupabaseClient | null = null;

  constructor(
    private readonly api: Api,
    private readonly store: KeyStore,
    private readonly supabaseConfig: () => { url: string; anonKey: string },
    private readonly now: () => number = () => Date.now() / 1000,
    /** Tests pass a fake Supabase client. */
    private readonly makeClient: (url: string, key: string, store: KeyStore) => SupabaseClient = (url, key, store) =>
      createClient(url, key, {
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
      }),
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
    this.supabase ??= this.makeClient(url, anonKey, this.store);
    return this.supabase;
  }

  private async save(out: SessionOut, kind: Session["kind"]): Promise<Session> {
    this.session = { ...out, kind };
    await this.store.set(BACKEND, JSON.stringify(this.session));
    return this.session;
  }

  /** Email and password. */
  async signIn(email: string, password: string): Promise<Session> {
    const { data, error } = await this.client().auth.signInWithPassword({ email: email.trim(), password });
    if (error || !data.session) throw new Error(friendly(error?.message ?? "Sign-in failed"));
    return this.save(await this.api.exchangeSupabase(data.session.access_token), "supabase");
  }

  /** New account; needsConfirmation means a code was emailed to confirm the address (then verifyCode). */
  async signUp(email: string, password: string): Promise<{ needsConfirmation: boolean }> {
    if (password.length < MIN_PASSWORD_LENGTH) throw new Error(`Use at least ${MIN_PASSWORD_LENGTH} characters for the password.`);
    const { data, error } = await this.client().auth.signUp({ email: email.trim(), password });
    if (error) throw new Error(friendly(error.message));
    if (data.user && data.user.identities?.length === 0) throw new Error(friendly("User already registered"));
    if (data.session) {
      await this.save(await this.api.exchangeSupabase(data.session.access_token), "supabase");
      return { needsConfirmation: false };
    }
    return { needsConfirmation: true };
  }

  /** Change (or set a first) password while signed in. */
  async setPassword(password: string): Promise<void> {
    if (password.length < MIN_PASSWORD_LENGTH) throw new Error(`Use at least ${MIN_PASSWORD_LENGTH} characters for the password.`);
    if (this.session?.kind !== "supabase") throw new Error("Sign in with your email first.");
    const { error } = await this.client().auth.updateUser({ password });
    if (error) throw new Error(friendly(error.message));
  }

  async sendCode(email: string): Promise<void> {
    const { error } = await this.client().auth.signInWithOtp({ email: email.trim() });
    if (error) throw new Error(friendly(error.message));
  }

  async verifyCode(email: string, code: string): Promise<Session> {
    // "email" covers sign-in codes; a new account's confirmation code is type "signup".
    let { data, error } = await this.client().auth.verifyOtp({ email: email.trim(), token: code.trim(), type: "email" });
    if (error || !data.session) {
      const retry = await this.client().auth.verifyOtp({ email: email.trim(), token: code.trim(), type: "signup" });
      if (retry.data.session) ({ data, error } = retry);
    }
    if (error || !data.session) throw new Error(friendly(error?.message ?? "That code didn't work"));
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
