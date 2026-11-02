// Content Security Policy for every renderer page.
// Production is strict. Dev allows Vite's HMR socket and React Refresh's inline preamble.

export function contentSecurityPolicy(dev: boolean, devServerUrl?: string): string {
  const devOrigin = dev && devServerUrl ? new URL(devServerUrl).origin : "";
  const devWs = devOrigin.replace(/^http/, "ws");
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": dev ? ["'self'", "'unsafe-inline'", devOrigin] : ["'self'"],
    "style-src": dev ? ["'self'", "'unsafe-inline'", devOrigin] : ["'self'"],
    "img-src": ["'self'", "data:"],
    "font-src": ["'self'"],
    // The renderer never talks to the network; the main process owns the backend connection.
    "connect-src": dev ? ["'self'", devOrigin, devWs] : ["'self'"],
    "object-src": ["'none'"],
    "base-uri": ["'none'"],
    "form-action": ["'none'"],
    "frame-ancestors": ["'none'"],
  };
  return Object.entries(directives)
    .map(([k, v]) => `${k} ${v.filter(Boolean).join(" ")}`)
    .join("; ");
}
