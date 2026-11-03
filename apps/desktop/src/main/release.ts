// Release plumbing for the packaged app: auto-update from GitHub Releases and opt-in crash
// reports. Both are no-ops in development and in tests.

import { app } from "electron";

/** Crash reports go to Sentry only when the build has a DSN and you turned diagnostics on. */
export async function initCrashReports(dsn: string | undefined, enabled: boolean): Promise<boolean> {
  if (!dsn || !enabled || !app.isPackaged) return false;
  const Sentry = await import("@sentry/electron/main");
  Sentry.init({
    dsn,
    release: app.getVersion(),
    // Meeting content never leaves in a crash report: no breadcrumbs with bodies, no request data.
    maxBreadcrumbs: 20,
    beforeBreadcrumb: (b) => (b.category === "console" || b.category === "fetch" ? null : b),
    beforeSend: (event) => {
      delete event.request;
      delete event.user;
      if (event.extra) delete event.extra;
      return event;
    },
  });
  return true;
}

export async function initAutoUpdate(enabled: boolean): Promise<boolean> {
  if (!enabled || !app.isPackaged || process.env.COPILOT_NO_UPDATE === "1") return false;
  const { autoUpdater } = (await import("electron-updater")).default;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  // Unsigned Windows test builds can't verify the publisher; only allow that for those builds.
  autoUpdater.on("error", (err) => console.warn("[update]", err.message));
  void autoUpdater.checkForUpdatesAndNotify().catch((err: Error) => console.warn("[update]", err.message));
  return true;
}
