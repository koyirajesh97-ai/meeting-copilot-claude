// Global hotkeys from the PRD: Ctrl/Cmd+Shift plus R, C, L, F, E.

export type HotkeyCommand = "toggle_capture" | "catch_up" | "clarify" | "follow_up" | "toggle_expand";

export interface Hotkey {
  accelerator: string;
  command: HotkeyCommand;
  label: string;
}

export const HOTKEYS: readonly Hotkey[] = [
  { accelerator: "CommandOrControl+Shift+R", command: "toggle_capture", label: "Start / stop recording" },
  { accelerator: "CommandOrControl+Shift+C", command: "catch_up", label: "Catch me up" },
  { accelerator: "CommandOrControl+Shift+L", command: "clarify", label: "Clarify" },
  { accelerator: "CommandOrControl+Shift+F", command: "follow_up", label: "I'll follow up" },
  { accelerator: "CommandOrControl+Shift+E", command: "toggle_expand", label: "Expand / compact overlay" },
];
