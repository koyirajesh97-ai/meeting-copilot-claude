import { describe, expect, it } from "vitest";
import { checkServer, normalizeServerUrl } from "./ConnectServer";

describe("server address", () => {
  it("adds https and drops trailing slashes", () => {
    expect(normalizeServerUrl(" copilot.example.com/ ")).toBe("https://copilot.example.com");
    expect(normalizeServerUrl("http://127.0.0.1:8000")).toBe("http://127.0.0.1:8000");
    expect(normalizeServerUrl("https://x.example.com/api/")).toBe("https://x.example.com/api");
  });

  it("rejects empty and non-web addresses", () => {
    expect(normalizeServerUrl("")).toBeNull();
    expect(normalizeServerUrl("ftp://x.example.com")).toBeNull();
    expect(normalizeServerUrl("not a url")).toBeNull();
  });
});

describe("server check", () => {
  const reply = (status: number, body: unknown) => async () => new Response(JSON.stringify(body), { status });

  it("accepts a Meeting Copilot server", async () => {
    expect(await checkServer("https://a", reply(200, { status: "ok", dev_login: false }))).toBeNull();
  });

  it("explains what went wrong otherwise", async () => {
    expect(await checkServer("https://a", reply(404, {}))).toMatch("404");
    expect(await checkServer("https://a", reply(200, { hello: 1 }))).toMatch("isn't a Meeting Copilot server");
    expect(await checkServer("https://a", async () => Promise.reject(new TypeError("offline")))).toMatch("Couldn't reach it");
  });
});
