import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";
import { resolve } from "node:path";
import type { Plugin } from "vite";
import { contentSecurityPolicy } from "./src/main/csp";

/** Bake the strict CSP into built HTML (file:// pages don't get response headers). */
function cspMeta(): Plugin {
  return {
    name: "csp-meta",
    apply: "build",
    transformIndexHtml(html: string) {
      const meta = `<meta http-equiv="Content-Security-Policy" content="${contentSecurityPolicy(false)}" />`;
      return html.replace("<head>", `<head>\n    ${meta}`);
    },
  };
}

export default defineConfig({
  main: {
    build: { rollupOptions: { input: resolve(__dirname, "src/main/index.ts") } },
  },
  preload: {
    build: {
      rollupOptions: {
        input: resolve(__dirname, "src/preload/index.ts"),
        // Sandboxed preload scripts must be CommonJS.
        output: { format: "cjs", entryFileNames: "[name].cjs" },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, "src/renderer"),
    plugins: [react(), tailwindcss(), cspMeta()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, "src/renderer/index.html"),
          overlay: resolve(__dirname, "src/renderer/overlay.html"),
        },
      },
    },
  },
});
