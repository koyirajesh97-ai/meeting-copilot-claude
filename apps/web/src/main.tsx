import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "@desktop/renderer/src/App";
import { useAppState, useSettings } from "@desktop/renderer/src/useAppState";
import { createWebApi, loadSettings } from "./bridge/web";
import { ConnectServer } from "./ConnectServer";
import { LoginScreen } from "./LoginScreen";
import { WebOverlay } from "./WebOverlay";
import "./web.css";

// No server configured for this site yet: ask for one (there's no sample data).
const connected = !!loadSettings().backendUrl;
if (connected) window.copilot = createWebApi();

/** Signed out: the sign-in page. Signed in: the app. */
function Root() {
  const state = useAppState();
  useSettings(); // applies the theme on the sign-in page too
  if (!state) return null; // a Google sign-in may be finishing
  if (!state.auth.signedIn) return <LoginScreen />;
  return (
    <>
      <App />
      <WebOverlay />
    </>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode>{connected ? <Root /> : <ConnectServer />}</StrictMode>);
