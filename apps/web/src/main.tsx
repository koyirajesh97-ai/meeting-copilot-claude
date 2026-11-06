import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "@desktop/renderer/src/App";
import { createWebApi, loadSettings } from "./bridge/web";
import { ConnectServer } from "./ConnectServer";
import { WebOverlay } from "./WebOverlay";
import "./web.css";

// No server configured for this site yet: ask for one (there's no sample data).
const connected = !!loadSettings().backendUrl;
if (connected) window.copilot = createWebApi();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {connected ? (
      <>
        <App />
        <WebOverlay />
      </>
    ) : (
      <ConnectServer />
    )}
  </StrictMode>,
);
