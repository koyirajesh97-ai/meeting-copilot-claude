import { useEffect, useState } from "react";
import type { IntegrationInfo, IntegrationKind } from "../../../shared/ipc";
import { errorText } from "../projects/useProjects";
import { useAppState } from "../useAppState";
import { buttonClass, inputClass, secondaryButtonClass } from "./EmptyState";

const HELP: Record<IntegrationKind, string> = {
  google: "See today's meetings, start them with the right type, and get a nudge a minute before.",
  microsoft: "Same, for Outlook and Microsoft 365 calendars.",
  jira: "Your tickets updated since the last standup go into Standup prep. Use an API token from id.atlassian.com.",
  slack: "Post a meeting summary to a channel, always after you preview it. Use an incoming webhook URL.",
  teams: "Post a meeting summary to a Teams channel (Workflows: “Post to a channel when a webhook request is received”).",
};

/** Settings → Integrations: each one has its own toggle; secrets go to the backend, never back. */
export function IntegrationsSection() {
  const [items, setItems] = useState<IntegrationInfo[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const load = () =>
    void window.copilot.integrations<IntegrationInfo[]>({ op: "list" }).then(
      (l) => (setItems(l), setNote(null)),
      () => (setItems(null), setNote("Sign in to connect your calendar, Jira, Slack or Teams.")),
    );
  const signedIn = useAppState()?.auth.signedIn;
  useEffect(load, [signedIn]);
  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      await fn();
      setNote(ok ?? null);
      load();
    } catch (e) {
      setNote(errorText(e));
    }
  };
  if (!items) return note ? <p className="text-xs text-gray-500">{note}</p> : null;
  return (
    <div className="space-y-4" role="region" aria-label="Integrations">
      <h2 className="font-medium">Integrations</h2>
      {items.map((i) => (
        <IntegrationRow key={i.kind} info={i} run={run} />
      ))}
      {note && <p role="status" className="text-xs text-gray-500 dark:text-gray-400" data-testid="integrations-note">{note}</p>}
    </div>
  );
}

function IntegrationRow({ info, run }: { info: IntegrationInfo; run: (fn: () => Promise<unknown>, ok?: string) => Promise<void> }) {
  const [site, setSite] = useState(info.config.site ?? "");
  const [email, setEmail] = useState(info.config.email ?? "");
  const [secret, setSecret] = useState("");
  const k = info.kind;
  const [on, setOn] = useState(info.enabled && info.connected);
  useEffect(() => setOn(info.enabled && info.connected), [info.enabled, info.connected]);
  const calendar = k === "google" || k === "microsoft";
  // Turning a calendar on: save the toggle; if it isn't connected yet, open the provider's sign-in.
  const turnOnCalendar = () =>
    run(async () => {
      const out = await window.copilot.integrations<IntegrationInfo>({ op: "save", kind: k, enabled: true });
      if (!out.connected) await window.copilot.integrations({ op: "connect", kind: k as "google" });
    }, `${info.label} is on.`);
  const save = (enabled: boolean) =>
    run(
      () =>
        window.copilot.integrations({
          op: "save", kind: k, enabled,
          ...(k === "jira" ? { site, email, api_token: secret || undefined } : {}),
          ...(k === "slack" || k === "teams" ? { webhook_url: secret || undefined } : {}),
        }),
      enabled ? `${info.label} is on.` : `${info.label} is off.`,
    ).then(() => setSecret(""));
  return (
    <div className="rounded-md border border-gray-200 p-3 text-sm dark:border-gray-800" data-testid={`integration-${k}`}>
      <div className="flex items-center justify-between gap-2">
        <label className="flex items-center gap-2 font-medium">
          <input
            type="checkbox"
            aria-label={`Use ${info.label}`}
            checked={on}
            disabled={!info.available}
            onChange={(e) => {
              setOn(e.target.checked); // shown at once; the saved state comes back with the reload
              void (e.target.checked && calendar ? turnOnCalendar() : save(e.target.checked));
            }}
          />
          {info.label}
        </label>
        <span className="text-xs text-gray-500">{info.connected ? (info.enabled ? "Connected" : "Off") : "Not set up"}</span>
      </div>
      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{HELP[k]}</p>
      {!info.available && <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">The backend needs its {info.label} OAuth client (see the README).</p>}
      {info.last_error && <p className="mt-1 text-xs text-red-600">{info.last_error}</p>}
      {calendar && info.available && (
        <div className="mt-2 flex gap-2">
          <button type="button" className={secondaryButtonClass} onClick={() => void run(() => window.copilot.integrations({ op: "connect", kind: k as "google" }), "Finish signing in in your browser, then come back.")}>
            {info.connected ? "Reconnect" : "Connect"}
          </button>
          {info.connected && <button type="button" className={secondaryButtonClass} onClick={() => void run(() => window.copilot.integrations({ op: "remove", kind: k }))}>Disconnect</button>}
        </div>
      )}
      {!calendar && (
        <div className="mt-2 space-y-2">
          {k === "jira" && (
            <>
              <input className={inputClass} aria-label="Jira site" placeholder="https://yourteam.atlassian.net" value={site} onChange={(e) => setSite(e.target.value)} />
              <input className={inputClass} aria-label="Jira email" placeholder="you@company.com" value={email} onChange={(e) => setEmail(e.target.value)} />
            </>
          )}
          <input
            type="password"
            className={inputClass}
            aria-label={k === "jira" ? "Jira API token" : `${info.label} webhook URL`}
            placeholder={info.connected ? "Saved (type to replace)" : k === "jira" ? "API token" : "https://…"}
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
          />
          <div className="flex gap-2">
            <button type="button" className={buttonClass} onClick={() => void save(true)}>Save</button>
            {info.connected && <button type="button" className={secondaryButtonClass} onClick={() => void run(() => window.copilot.integrations({ op: "remove", kind: k }))}>Remove</button>}
          </div>
        </div>
      )}
    </div>
  );
}
