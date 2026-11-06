import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { defineConfig } from "vite";

// The web app is the desktop app's screens (apps/desktop/src/renderer) with a browser bridge in
// place of Electron's. VITE_BACKEND_URL and the Supabase settings are read at build time.
export default defineConfig({
  root: import.meta.dirname,
  // GitHub Pages serves the site under /<repo>/; Vercel and local dev serve it at /.
  base: process.env.WEB_BASE || "/",
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@desktop": resolve(import.meta.dirname, "../desktop/src"),
      // The shared backend code uses Node's EventEmitter; the `events` package is its browser twin.
      "node:events": createRequire(import.meta.url).resolve("events/"),
    },
  },
  server: { port: 5190 },
  build: { outDir: "dist", sourcemap: true, chunkSizeWarningLimit: 900 },
});
