import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "@desktop/renderer/src/App";
import { demoApi } from "./bridge/demo";
import { createWebApi, loadSettings } from "./bridge/web";
import { WebOverlay } from "./WebOverlay";
import "./web.css";

// No backend configured for this site: show the demo (sample data, nothing recorded).
const demo = !loadSettings().backendUrl;
window.copilot = demo ? demoApi : createWebApi();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {demo && (
      <div role="status" data-testid="demo-banner" className="fixed inset-x-0 bottom-0 z-40 bg-slate-900 px-3 py-1.5 text-center text-xs text-slate-200">
        Demo with sample meetings: nothing is recorded. Connect your server in Settings, or get the desktop app.
      </div>
    )}
    <App />
    <WebOverlay raised={demo} />
  </StrictMode>,
);
