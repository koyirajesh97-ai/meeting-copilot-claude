import { useEffect, useState } from "react";
import type { AppState, Settings } from "../../shared/ipc";
import { applyTheme } from "./theme";

export function useAppState(): AppState | null {
  const [state, setState] = useState<AppState | null>(null);
  useEffect(() => {
    let live = true;
    void window.copilot.getState().then((s) => live && setState(s));
    const off = window.copilot.onState(setState);
    return () => {
      live = false;
      off();
    };
  }, []);
  return state;
}

/** Settings, kept in sync with the main process; also applies the theme. */
export function useSettings(): [Settings | null, (patch: Partial<Settings>) => Promise<void>] {
  const [settings, setSettings] = useState<Settings | null>(null);
  useEffect(() => {
    const load = () => void window.copilot.getSettings().then((s) => {
      setSettings(s);
      applyTheme(s);
    });
    load();
    // Settings changes are broadcast with state; reload so every window stays in sync.
    return window.copilot.onState(load);
  }, []);
  const update = async (patch: Partial<Settings>) => {
    const next = await window.copilot.setSettings(patch);
    setSettings(next);
    applyTheme(next);
  };
  return [settings, update];
}
