import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { AudioCheck, ProviderKey, RoleProfile, Settings } from "../../../shared/ipc";
import { MEETING_MODES } from "../../../shared/meetings";
import { AccountSettings } from "../components/AccountSettings";
import { buttonClass, inputClass, PageHeader, secondaryButtonClass } from "../components/EmptyState";
import { errorText } from "../projects/useProjects";
import { useAppState, useSettings } from "../useAppState";

const STEPS = ["Welcome", "Audio", "Sign in", "AI keys", "Your role", "Privacy"] as const;

/** First run: capture, sign-in, AI keys and profile working in a few minutes. Every step can be skipped. */
export function SetupPage() {
  const [settings, update] = useSettings();
  const [step, setStep] = useState(0);
  const navigate = useNavigate();
  if (!settings) return null;
  const finish = async () => {
    await update({ setupDone: true });
    navigate("/");
  };
  const next = () => (step === STEPS.length - 1 ? void finish() : setStep(step + 1));
  return (
    <section className="max-w-2xl space-y-6">
      <PageHeader title="Set up Meeting Copilot">
        <button type="button" className="text-sm underline" onClick={() => void finish()}>
          Skip setup
        </button>
      </PageHeader>
      <ol className="flex flex-wrap gap-2 text-xs" aria-label="Setup steps">
        {STEPS.map((s, i) => (
          <li key={s}>
            <button
              type="button"
              aria-current={i === step ? "step" : undefined}
              className={`rounded-full px-3 py-1 ${i === step ? "bg-blue-600 text-white" : i < step ? "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200" : "bg-gray-100 dark:bg-gray-900"}`}
              onClick={() => setStep(i)}
            >
              {i + 1}. {s}
            </button>
          </li>
        ))}
      </ol>
      <div className="rounded-lg border border-gray-200 p-5 dark:border-gray-800" data-testid={`setup-step-${step}`}>
        {step === 0 && <Welcome />}
        {step === 1 && <AudioStep />}
        {step === 2 && <SignInStep settings={settings} update={update} />}
        {step === 3 && <KeysStep />}
        {step === 4 && <RoleStep />}
        {step === 5 && <PrivacyStep settings={settings} update={update} />}
      </div>
      <div className="flex justify-between">
        <button type="button" className={secondaryButtonClass} disabled={step === 0} onClick={() => setStep(step - 1)}>
          Back
        </button>
        <button type="button" className={buttonClass} onClick={next}>
          {step === STEPS.length - 1 ? "Finish" : "Next"}
        </button>
      </div>
    </section>
  );
}

function Welcome() {
  return (
    <div className="space-y-2 text-sm">
      <h2 className="text-lg font-medium">Live help in any meeting, without a bot joining</h2>
      <p>Meeting Copilot records your microphone and the meeting audio on this computer, shows live captions, answers questions aimed at you, and writes the summary afterwards.</p>
      <ul className="list-disc space-y-1 pl-5">
        <li>A red indicator shows whenever it records. Tell people you're recording (the Announce button helps).</li>
        <li>AI keys stay on your backend; this app gets a short-lived token only.</li>
        <li>Meeting content only goes to AI services that don't train on it.</li>
      </ul>
      <p className="text-gray-500 dark:text-gray-400">About five minutes. You can skip any step and change everything later in Settings.</p>
    </div>
  );
}

function Meter({ label, value, state }: { label: string; value: number; state: string }) {
  return (
    <div className="text-sm">
      <div className="flex justify-between">
        <span>{label}</span>
        <span className="text-xs text-gray-500">{state}</span>
      </div>
      <div className="h-2 rounded bg-gray-200 dark:bg-gray-800" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value * 100)}>
        <div className="h-2 rounded bg-green-500" style={{ width: `${Math.min(100, value * 100)}%` }} />
      </div>
    </div>
  );
}

function AudioStep() {
  const state = useAppState();
  const [levels, setLevels] = useState({ mic: 0, system: 0 });
  const [result, setResult] = useState<AudioCheck | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => window.copilot.onLevels(setLevels), []);
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      setResult(await window.copilot.setup<AudioCheck>({ op: "audioCheck" }));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const heard = (c: { state: string; peak: number }) => c.state === "live" && c.peak > 0.01;
  return (
    <div className="space-y-3">
      <h2 className="text-lg font-medium">Check your microphone and the meeting audio</h2>
      <p className="text-sm text-gray-500 dark:text-gray-400">Records 5 seconds (nothing is saved or sent). Talk, and play a video or a meeting so the second meter moves too.</p>
      <Meter label="Your microphone" value={busy ? levels.mic : result?.mic.peak ?? 0} state={busy ? state?.audio.mic.state ?? "" : result?.mic.state ?? "not tested"} />
      <Meter label="Meeting audio" value={busy ? levels.system : result?.system.peak ?? 0} state={busy ? state?.audio.system.state ?? "" : result?.system.state ?? "not tested"} />
      <button type="button" className={buttonClass} disabled={busy} onClick={() => void run()}>
        {busy ? "Listening…" : result ? "Test again" : "Test audio"}
      </button>
      {result && (
        <ul className="space-y-1 text-sm" data-testid="audio-result">
          <li>{heard(result.mic) ? "✓ Your microphone works." : `✗ No sound from your microphone${result.mic.message ? `: ${result.mic.message}` : ""}. Check the device in Settings and the OS microphone permission.`}</li>
          <li>
            {heard(result.system) ? "✓ Meeting audio works." : `✗ No meeting audio${result.system.message ? `: ${result.system.message}` : ""}. `}
            {!heard(result.system) && <Link to="/help/system-audio" className="underline">How to fix it</Link>}
          </li>
        </ul>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}

function SignInStep({ settings, update }: { settings: Settings; update: (p: Partial<Settings>) => Promise<void> }) {
  const [url, setUrl] = useState(settings.backendUrl);
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-medium">Connect to your backend and sign in</h2>
      <label className="block text-sm">
        Backend URL
        <input className={`${inputClass} mt-1`} value={url} onChange={(e) => setUrl(e.target.value)} onBlur={() => void update({ backendUrl: url.trim() })} />
      </label>
      <AccountSettings settings={settings} update={update} />
    </div>
  );
}

function KeysStep() {
  const signedIn = useAppState()?.auth.signedIn;
  const [rows, setRows] = useState<ProviderKey[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () => void window.copilot.setup<ProviderKey[]>({ op: "providers" }).then(setRows, (e) => setError(errorText(e)));
  useEffect(() => {
    if (signedIn) load();
  }, [signedIn]);
  if (!signedIn) return <p className="text-sm">Sign in first (previous step); the keys are checked by your backend.</p>;
  return (
    <div className="space-y-3">
      <h2 className="text-lg font-medium">Free AI keys</h2>
      <p className="text-sm text-gray-500 dark:text-gray-400">
        Three free keys (no card) cover everything: Groq, Mistral and Deepgram. Paste each one; it's tested with one tiny request and saved on your backend, never in this app.
      </p>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <ul className="space-y-3" aria-label="AI providers">
        {rows?.map((r) => <KeyRow key={r.provider} row={r} onSaved={load} />)}
      </ul>
    </div>
  );
}

function KeyRow({ row, onSaved }: { row: ProviderKey; onSaved: () => void }) {
  const [key, setKey] = useState("");
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const test = async () => {
    setBusy(true);
    try {
      const r = await window.copilot.setup<{ ok: boolean; detail: string; saved: boolean; env_line: string | null }>({ op: "saveKey", provider: row.provider, key });
      setNote({
        ok: r.ok,
        text: !r.ok ? `That key didn't work: ${r.detail}` : r.saved ? "Works, and saved on your backend." : `Works. Add ${r.env_line} to your backend's environment (it isn't running on this computer).`,
      });
      if (r.saved) {
        setKey("");
        onSaved();
      }
    } catch (e) {
      setNote({ ok: false, text: errorText(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <li className="rounded-md border border-gray-200 p-3 text-sm dark:border-gray-800" data-testid={`key-${row.provider}`}>
      <div className="flex items-center justify-between">
        <span className="font-medium">
          {row.provider}
          {row.required ? "" : <span className="ml-2 text-xs font-normal text-gray-500">optional fallback</span>}
        </span>
        <span className={row.has_key ? "text-green-700 dark:text-green-400" : "text-gray-500"}>{row.has_key ? "✓ Key set" : "No key yet"}</span>
      </div>
      <p className="text-xs text-gray-500">
        {row.trains_on_data === false ? "Doesn't train on your data. " : "Test data only (may train on what it gets). "}
        Used for {row.tasks.join(", ")}.
        {row.signup_url && (
          <>
            {" "}
            <a className="underline" href={row.signup_url} target="_blank" rel="noreferrer">Get a free key</a>
          </>
        )}
      </p>
      <div className="mt-2 flex gap-2">
        <input type="password" className={inputClass} aria-label={`${row.provider} API key`} placeholder={row.key_env} value={key} onChange={(e) => setKey(e.target.value)} />
        <button type="button" className={secondaryButtonClass} disabled={busy || key.trim().length < 8} onClick={() => void test()}>
          {busy ? "Testing…" : "Test and save"}
        </button>
      </div>
      {note && <p className={`mt-1 text-xs ${note.ok ? "text-green-700 dark:text-green-400" : "text-red-600"}`} role="status">{note.text}</p>}
    </li>
  );
}

function RoleStep() {
  const signedIn = useAppState()?.auth.signedIn;
  const [presets, setPresets] = useState<Record<string, RoleProfile>>({});
  const [profile, setProfile] = useState<RoleProfile | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (!signedIn) return;
    void window.copilot.profile.presets().then(setPresets);
    void window.copilot.profile.get().then(setProfile);
  }, [signedIn]);
  if (!signedIn || !profile) return <p className="text-sm">Sign in first; your role is kept on your backend.</p>;
  return (
    <div className="space-y-3 text-sm">
      <h2 className="text-lg font-medium">Who you are in meetings</h2>
      <p className="text-gray-500 dark:text-gray-400">Your name and role decide which questions are for you and how suggested answers sound. More detail (systems, tickets) under Your role.</p>
      <label className="block">
        Your name (as people say it)
        <input className={`${inputClass} mt-1`} value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} />
      </label>
      <label className="block">
        Role
        <select
          className={`${inputClass} mt-1`}
          aria-label="Role preset"
          value=""
          onChange={(e) => presets[e.target.value] && setProfile({ ...presets[e.target.value], name: profile.name, aliases: profile.aliases })}
        >
          <option value="">{profile.title || "Pick a role"}</option>
          {Object.entries(presets).filter(([k]) => k !== "custom").map(([k, p]) => (
            <option key={k} value={k}>{p.title}</option>
          ))}
        </select>
      </label>
      <button type="button" className={secondaryButtonClass} onClick={() => void window.copilot.profile.put(profile).then(() => setSaved(true))}>
        {saved ? "Saved" : "Save"}
      </button>
      <p>
        Optional: <Link to="/voice" className="underline">enroll your voice</Link> so you're named in transcripts (only with your consent).
      </p>
    </div>
  );
}

function PrivacyStep({ settings, update }: { settings: Settings; update: (p: Partial<Settings>) => Promise<void> }) {
  return (
    <fieldset className="space-y-3 text-sm">
      <legend className="text-lg font-medium">How meetings start by default</legend>
      {MEETING_MODES.map((m) => (
        <label key={m.id} className="flex items-start gap-2">
          <input type="radio" name="default-mode" className="mt-1" checked={settings.defaultMode === m.id} onChange={() => void update({ defaultMode: m.id })} />
          <span>
            {m.label} <span className="text-gray-500 dark:text-gray-400">— {m.hint}</span>
          </span>
        </label>
      ))}
      <label className="flex items-start gap-2 pt-2">
        <input type="checkbox" className="mt-1" checked={settings.diagnostics} onChange={(e) => void update({ diagnostics: e.target.checked })} />
        <span>
          Send crash reports and request timings to help fix problems
          <span className="block text-xs text-gray-500 dark:text-gray-400">Off by default. Never includes what was said, summaries or names.</span>
        </span>
      </label>
      <p className="text-gray-500 dark:text-gray-400">You can change each meeting's mode on Start meeting, and retention and providers under Settings → Privacy.</p>
    </fieldset>
  );
}
