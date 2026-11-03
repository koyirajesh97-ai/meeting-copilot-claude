import { IntegrationsSection } from "../components/IntegrationsSection";
import { PrivacySection } from "../components/PrivacySection";
import { useEffect, useState } from "react";
import { CAPTION_FONT_RANGE, type Theme } from "../../../shared/ipc";
import { AccountSettings } from "../components/AccountSettings";
import { inputClass, PageHeader } from "../components/EmptyState";
import { useSettings } from "../useAppState";

const HOTKEY_LIST = [
  ["Ctrl/Cmd + Shift + R", "Start / stop recording"],
  ["Ctrl/Cmd + Shift + C", "Catch me up"],
  ["Ctrl/Cmd + Shift + L", "Clarify"],
  ["Ctrl/Cmd + Shift + F", "I'll follow up"],
  ["Ctrl/Cmd + Shift + E", "Expand / compact overlay"],
];

export function SettingsPage() {
  const [settings, update] = useSettings();
  if (!settings) return null;
  return (
    <section className="max-w-xl space-y-8">
      <PageHeader title="Settings" />
      <AccountSettings settings={settings} update={update} />
      <div className="space-y-4">
        <h2 className="font-medium">Appearance</h2>
        <label className="block text-sm">
          Theme
          <select className={`${inputClass} mt-1`} value={settings.theme} onChange={(e) => void update({ theme: e.target.value as Theme })}>
            <option value="system">Match system</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={settings.highContrast} onChange={(e) => void update({ highContrast: e.target.checked })} />
          High contrast
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
      </div>
      <AudioSettings micDeviceId={settings.micDeviceId} systemAudioApp={settings.systemAudioApp} update={update} />
      <div className="space-y-2">
        <h2 className="font-medium">Backend</h2>
        <label className="block text-sm">
          Backend URL
          <input
            className={`${inputClass} mt-1`}
            defaultValue={settings.backendUrl}
            onBlur={(e) => void update({ backendUrl: e.target.value })}
          />
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
      <IntegrationsSection />
      <PrivacySection />
    </section>
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
