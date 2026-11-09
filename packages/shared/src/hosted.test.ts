import { describe, expect, it } from "vitest";
import { HOSTED_BACKEND_URL, HOSTED_SUPABASE } from "./hosted";

describe("config/client.json", () => {
  it("points at an https Supabase project with a public key only", () => {
    expect(HOSTED_SUPABASE.url).toMatch(/^https:\/\/[a-z0-9]+\.supabase\.co$/);
    // Publishable or legacy anon key: never a secret or service-role key.
    expect(HOSTED_SUPABASE.publishableKey).toMatch(/^sb_publishable_|^eyJ/);
    expect(HOSTED_SUPABASE.publishableKey).not.toMatch(/^sb_secret_/);
  });

  it("has no server, or an https one", () => {
    expect(HOSTED_BACKEND_URL === "" || /^https:\/\/[^/]+$/.test(HOSTED_BACKEND_URL)).toBe(true);
  });
});
