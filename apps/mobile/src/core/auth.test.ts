import { describe, expect, it } from "vitest";
import type { Api, SessionOut } from "./api";
import { Auth, type KeyStore } from "./auth";

class MemoryStore implements KeyStore {
  m = new Map<string, string>();
  async get(k: string) {
    return this.m.get(k) ?? null;
  }
  async set(k: string, v: string) {
    this.m.set(k, v);
  }
  async delete(k: string) {
    this.m.delete(k);
  }
}

const api = { exchangeSupabase: async (t: string): Promise<SessionOut> => ({ token: `backend-${t}`, expires_at: 9e9, email: "a@b.co" }) } as unknown as Api;

function fake(over: Record<string, unknown> = {}) {
  const session = { access_token: "sb" };
  const calls: string[] = [];
  const authApi = {
    signInWithPassword: async ({ password }: { password: string }) =>
      password === "right-password" ? { data: { session }, error: null } : { data: { session: null }, error: { message: "Invalid login credentials" } },
    signUp: async () => (calls.push("signUp"), { data: { session: null, user: { identities: [{}] } }, error: null }),
    verifyOtp: async ({ type }: { type: string }) => (calls.push(type), type === "signup" ? { data: { session }, error: null } : { data: { session: null }, error: { message: "Token has expired or is invalid" } }),
    updateUser: async () => (calls.push("updateUser"), { data: {}, error: null }),
    ...over,
  };
  return { make: () => ({ auth: authApi }) as never, calls };
}
const cfg = () => ({ url: "https://x.supabase.co", anonKey: "sb_publishable_x" });

describe("phone sign-in", () => {
  it("signs in with a password and explains a wrong one", async () => {
    const { make } = fake();
    const auth = new Auth(api, new MemoryStore(), cfg, undefined, make);
    await expect(auth.signIn("a@b.co", "nope")).rejects.toThrow("Wrong email or password.");
    expect((await auth.signIn("a@b.co", "right-password")).token).toBe("backend-sb");
    await auth.setPassword("another-long-password");
    await expect(auth.setPassword("short")).rejects.toThrow("at least 8");
  });

  it("creates an account and confirms it with the emailed code", async () => {
    const { make, calls } = fake();
    const auth = new Auth(api, new MemoryStore(), cfg, undefined, make);
    await expect(auth.signUp("a@b.co", "short")).rejects.toThrow("at least 8");
    expect(await auth.signUp("a@b.co", "long-enough-password")).toEqual({ needsConfirmation: true });
    expect(auth.current).toBeNull();
    expect((await auth.verifyCode("a@b.co", "123456")).kind).toBe("supabase");
    expect(calls).toEqual(["signUp", "email", "signup"]);
  });

  it("says when the email already has an account", async () => {
    const { make } = fake({ signUp: async () => ({ data: { session: null, user: { identities: [] } }, error: null }) });
    const auth = new Auth(api, new MemoryStore(), cfg, undefined, make);
    await expect(auth.signUp("a@b.co", "long-enough-password")).rejects.toThrow("already an account");
  });
});
