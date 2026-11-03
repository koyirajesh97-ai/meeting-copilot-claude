import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CAPTION_FONT_RANGE, type Settings, type Theme } from "../../../shared/ipc";
import { MEETING_MODES } from "../../../shared/meetings";
import { AccountSettings } from "../components/AccountSettings";
import { inputClass, PageHeader, secondaryButtonClass } from "../components/EmptyState";
import { IntegrationsSection } from "../components/IntegrationsSection";
import { PrivacySection } from "../components/PrivacySection";
import { useSettings } from "../useAppState";

const HOTKEY_LIST = [
  ["Ctrl/Cmd + Shift + R", "Start / stop recording"],
  ["Ctrl/Cmd + Shift + C", "Catch me up"],
  ["Ctrl/Cmd + Shift + L", "Clarify"],
  ["Ctrl/Cmd + Shift + F", "I'll follow up"],
  ["Ctrl/Cmd + Shift + E", "Expand / compact overlay"],
];

const TABS = [
  { id: "account", label: "Account" },
  { id: "general", label: "General" },
  { id: "connections", label: "Connections" },
  { id: "privacy", label: "Privacy" },
  { id: "advanced", label: "Advanced" },
] as const;
type Tab = (typeof TABS)[number]["id"];

/** Settings in five tabs; the technical bits (servers, hotkeys, updates) live under Advanced. */
export function SettingsPage() {
  const [settings, update] = useSettings();
  const [params, setParams] = useSearchParams();
  const tab = (TABS.some((t) => t.id === params.get("tab")) ? params.get("tab") : "account") as Tab;
  if (!settings) return null;
  return (
    <section className="max-w-xl">
      <PageHeader title="Settings" />
      <div role="tablist" aria-label="Settings sections" className="mb-6 flex gap-1 border-b border-gray-200 dark:border-gray-800">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${tab === t.id ? "border-blue-600 font-medium text-blue-700 dark:text-blue-300" : "border-transparent text-gray-500 hover:text-gray-800 dark:hover:text-gray-200"}`}
            onClick={() => setParams({ tab: t.id }, { replace: true })}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" className="space-y-8">
        {tab === "account" && <AccountTab settings={settings} update={update} />}
        {tab === "general" && <GeneralTab settings={settings} update={update} />}
        {tab === "connections" && <IntegrationsSection />}
        {tab === "privacy" && <PrivacySection />}
        {tab === "advanced" && <AdvancedTab settings={settings} update={update} />}
      </div>
    </section>
  );
}

type TabProps = { settings: Settings; update: (p: Partial<Settings>) => Promise<void> };

function AccountTab({ settings, update }: TabProps) {
  return (
    <>
      <AccountSettings settings={settings} update={update} />
      <div className="space-y-2">
        <h2 className="font-medium">About you</h2>
        <Link to="/profile" className="block rounded-lg border border-gray-200 p-3 text-sm hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900">
          <span className="block font-medium">Your role</span>
          <span className="text-gray-500 dark:text-gray-400">Your name, job and systems, so the app knows which questions are for you.</span>
        </Link>
        <Link to="/voice" className="block rounded-lg border border-gray-200 p-3 text-sm hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900">
          <span className="block font-medium">Your voice</span>
          <span className="text-gray-500 dark:text-gray-400">Optional: record 30 seconds so you're named in transcripts.</span>
        </Link>
      </div>
    </>
  );
}

function GeneralTab({ settings, update }: TabProps) {
  return (
    <>
      <fieldset className="space-y-1 text-sm">
        <legend className="mb-1 font-medium">New meetings start as</legend>
        {MEETING_MODES.map((m) => (
          <label key={m.id} className="flex items-start gap-2">
            <input type="radio" name="default-mode" className="mt-1" checked={settings.defaultMode === m.id} onChange={() => void update({ defaultMode: m.id })} />
            <span>
              {m.label} <span className="text-gray-500 dark:text-gray-400">— {m.hint}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <AudioSettings micDeviceId={settings.micDeviceId} systemAudioApp={settings.systemAudioApp} update={update} />
      <div className="space-y-4">
        <h2 className="font-medium">Look</h2>
        <label className="block text-sm">
          Theme
          <select className={`${inputClass} mt-1`} value={settings.theme} onChange={(e) => void update({ theme: e.target.value as Theme })}>
            <option value="system">Match system</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </label>
        <label className="block text-sm">
          Caption size: {settings.captionFontSize}px
          <input
            type="range"
            className="mt-1 w-full"
            min={CAPTION_FONT_RANGE.min}
            max={CAPTION_FONT_RANGE.max}
            value={settings.captionFontSize}
            onChange={(e) => void update({ captionFontSize: Number(e.target.value) })}
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={settings.highContrast} onChange={(e) => void update({ highContrast: e.target.checked })} />
          High contrast
        </label>
      </div>
    </>
  );
}

function AdvancedTab({ settings, update }: TabProps) {
  const [syncNote, setSyncNote] = useState<string | null>(null);
  return (
    <>
      <div className="space-y-2">
        <h2 className="font-medium">Server</h2>
        <label className="block text-sm">
          Backend URL
          <input className={`${inputClass} mt-1`} defaultValue={settings.backendUrl} onBlur={(e) => void update({ backendUrl: e.target.value })} />
        </label>
        <button
          type="button"
          className={secondaryButtonClass}
          onClick={() => void window.copilot.meetings.sync().then((r) => setSyncNote(r.error ? `Couldn't sync: ${r.error}` : `Synced ${r.meetings} meeting(s)`))}
        >
          Sync now
        </button>
        {syncNote && <p className="text-xs text-gray-500 dark:text-gray-400">{syncNote}</p>}
      </div>
      <div className="space-y-2" role="region" aria-label="Updates and diagnostics">
        <h2 className="font-medium">Updates and diagnostics</h2>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={settings.autoUpdate} onChange={(e) => void update({ autoUpdate: e.target.checked })} />
          Install updates automatically
        </label>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={settings.diagnostics} onChange={(e) => void update({ diagnostics: e.target.checked })} />
          <span>
            Send crash reports and request timings
            <span className="block text-xs text-gray-500 dark:text-gray-400">Off by default. Never includes what was said, summaries or names.</span>
          </span>
        </label>
      </div>
      <div className="space-y-2">
        <h2 className="font-medium">Hotkeys</h2>
        <table className="text-sm">
          <tbody>
            {HOTKEY_LIST.map(([k, v]) => (
              <tr key={k}>
                <td className="pr-6 font-mono text-xs">{k}</td>
                <td>{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Link to="/setup" className="block text-sm underline">Run the setup again</Link>
    </>
  );
}

function AudioSettings({
  micDeviceId,
  systemAudioApp,
  update,
}: {
  micDeviceId: string | null;
  systemAudioApp: string | null;
  update: (patch: { micDeviceId?: string | null; systemAudioApp?: string | null }) => Promise<void>;
}) {
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  useEffect(() => {
    void navigator.mediaDevices
      ?.enumerateDevices()
      .then((d) => setMics(d.filter((x) => x.kind === "audioinput" && x.deviceId !== "default")))
      .catch(() => setMics([]));
  }, []);
  return (
    <div className="space-y-4">
      <h2 className="font-medium">Audio</h2>
      <label className="block text-sm">
        Microphone
        <select className={`${inputClass} mt-1`} value={micDeviceId ?? ""} onChange={(e) => void update({ micDeviceId: e.target.value || null })}>
          <option value="">System default</option>
          {mics.map((m, i) => (
            <option key={m.deviceId} value={m.deviceId}>
              {m.label || `Microphone ${i + 1}`}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm">
        Capture only this app's audio (Windows)
        <input
          className={`${inputClass} mt-1`}
          placeholder="All system audio — or e.g. ms-teams.exe"
          defaultValue={systemAudioApp ?? ""}
          onBlur={(e) => void update({ systemAudioApp: e.target.value.trim() || null })}
        />
        <span className="mt-1 block text-xs text-gray-500 dark:text-gray-400">
          Leave empty to record everything your computer plays. Per-app capture needs Windows 10 build 20348+ or Windows 11.
        </span>
      </label>
    </div>
  );
}
