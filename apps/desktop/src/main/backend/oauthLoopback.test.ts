import { describe, expect, it } from "vitest";
import { CALLBACK_PATH, loopbackSignIn, safeSignInUrl } from "./oauthLoopback";

const SIGN_IN = "https://example.supabase.co/auth/v1/authorize?provider=google";

/** Starts a sign-in and hands back the redirect address the "browser" was sent to. */
function start(timeoutMs?: number) {
  let redirect = "";
  let opened = "";
  let markReady!: () => void;
  const ready = new Promise<void>((ok) => (markReady = ok));
  const started = loopbackSignIn({
    buildUrl: async (r) => ((redirect = r), `${SIGN_IN}&redirect_to=${encodeURIComponent(r)}`),
    open: async (u) => ((opened = u), markReady()),
    timeoutMs,
  });
  return { ready, result: () => started, redirect: () => redirect, opened: () => opened };
}

describe("loopback Google sign-in", () => {
  it("opens the sign-in page and resolves with the code the browser brings back", async () => {
    const s = start();
    await s.ready;
    expect(s.redirect()).toMatch(new RegExp(`^http://127\\.0\\.0\\.1:\\d+${CALLBACK_PATH}$`));
    expect(s.opened().startsWith(SIGN_IN)).toBe(true);

    const other = await fetch(s.redirect().replace(CALLBACK_PATH, "/favicon.ico"));
    expect(other.status).toBe(404);

    const signedIn = expect(s.result()).resolves.toBe("abc123");
    const res = await fetch(`${s.redirect()}?code=abc123`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("You're signed in");
    await signedIn;
    // The one-shot server is gone afterwards.
    await expect(fetch(`${s.redirect()}?code=again`)).rejects.toThrow();
  });

  it("reports a provider error, escaped, and rejects", async () => {
    const s = start();
    await s.ready;
    const failed = expect(s.result()).rejects.toThrow(/denied/);
    const res = await fetch(`${s.redirect()}?error=access_denied&error_description=${encodeURIComponent("<b>denied</b>")}`);
    expect(res.status).toBe(400);
    const html = await res.text();
    expect(html).not.toContain("<b>");
    await failed;
  });

  it("a second attempt cancels the first, and attempts time out", async () => {
    const first = start();
    await first.ready;
    const second = start(50);
    await expect(first.result()).rejects.toThrow(/cancelled/);
    await second.ready;
    await expect(second.result()).rejects.toThrow(/timed out/);
  });

  it("never opens a non-https page", async () => {
    await expect(loopbackSignIn({ buildUrl: async () => "javascript:alert(1)", open: async () => undefined })).rejects.toThrow(/Unexpected/);
    expect(safeSignInUrl("http://evil.example/x")).toBe(false);
    expect(safeSignInUrl("http://localhost:54321/auth/v1/authorize")).toBe(true);
    expect(safeSignInUrl(SIGN_IN)).toBe(true);
  });
});
