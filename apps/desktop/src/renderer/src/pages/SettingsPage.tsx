import { CAPTION_FONT_RANGE, type Theme } from "../../../shared/ipc";
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
      <div className="space-y-1">
        <h2 className="font-medium">AI providers, audio devices, retention</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">These settings arrive with the provider router and audio capture.</p>
      </div>
    </section>
  );
}
