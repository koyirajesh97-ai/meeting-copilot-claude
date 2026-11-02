import type { Settings } from "../../shared/ipc";

/** Apply theme, contrast and caption size to <html> so Tailwind variants pick them up. */
export function applyTheme(settings: Settings): void {
  const root = document.documentElement;
  const dark =
    settings.theme === "dark" ||
    (settings.theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  root.dataset.theme = dark ? "dark" : "light";
  root.dataset.contrast = settings.highContrast ? "high" : "normal";
  root.style.setProperty("--caption-size", `${settings.captionFontSize}px`);
}
