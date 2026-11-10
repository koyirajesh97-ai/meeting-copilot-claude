// Google sign-in for the desktop app. The system browser does the sign-in (the app never sees
// the Google password); Google and Supabase then send the browser back to a one-shot server on
// 127.0.0.1 with ?code=, which the app trades for a session (PKCE, so the code alone is useless).

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export const CALLBACK_PATH = "/auth/callback";
const TIMEOUT_MS = 5 * 60_000;

export interface LoopbackOptions {
  /** Builds the provider's sign-in page for this redirect address. */
  buildUrl: (redirectTo: string) => Promise<string>;
  /** Opens a URL in the system browser. */
  open: (url: string) => Promise<void>;
  timeoutMs?: number;
}

const page = (title: string, text: string) =>
  `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><meta name="viewport" content="width=device-width"></head>` +
  `<body style="background:#04050d;color:#e2e8f0;font:16px system-ui,sans-serif;display:grid;place-items:center;height:100vh;margin:0">` +
  `<div style="text-align:center;max-width:420px;padding:24px"><h1 style="font-size:22px">${title}</h1><p style="color:#94a3b8">${text}</p></div></body></html>`;

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Only https pages (or a local Supabase on http://localhost) may be opened in the browser. */
export function safeSignInUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || (u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1"));
  } catch {
    return false;
  }
}

let active: (() => void) | null = null;

/** Runs one browser sign-in and resolves with the returned ?code=. A new call cancels the last. */
export function loopbackSignIn({ buildUrl, open, timeoutMs = TIMEOUT_MS }: LoopbackOptions): Promise<string> {
  active?.();
  return new Promise<string>((resolve, reject) => {
    let done = false;
    const finish = (err: Error | null, code?: string) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (active === cancel) active = null;
      server.close();
      server.closeAllConnections?.();
      if (err) reject(err);
      else resolve(code!);
    };
    const cancel = () => finish(new Error("Sign-in was cancelled."));

    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (req.method !== "GET" || url.pathname !== CALLBACK_PATH) {
        res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found");
        return;
      }
      const code = url.searchParams.get("code");
      const error = url.searchParams.get("error_description") ?? url.searchParams.get("error");
      const headers = { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'" };
      if (code) {
        res.writeHead(200, headers).end(page("You're signed in", "Go back to Meeting Copilot. You can close this tab."));
        finish(null, code);
      } else {
        const why = (error ?? "No sign-in code came back").slice(0, 300);
        res.writeHead(400, headers).end(page("Sign-in didn't finish", `${escapeHtml(why)}. Go back to Meeting Copilot and try again.`));
        finish(new Error(`Google sign-in didn't finish: ${why}`));
      }
    });
    server.on("error", (e) => finish(e));
    active = cancel;
    const timer = setTimeout(() => finish(new Error("Google sign-in timed out. Try again.")), timeoutMs);

    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      buildUrl(`http://127.0.0.1:${port}${CALLBACK_PATH}`)
        .then(async (url) => {
          if (!safeSignInUrl(url)) throw new Error("Unexpected sign-in page");
          await open(url);
        })
        .catch((e: unknown) => finish(e instanceof Error ? e : new Error(String(e))));
    });
  });
}
