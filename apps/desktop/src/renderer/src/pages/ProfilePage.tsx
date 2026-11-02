import { useEffect, useState } from "react";
import type { RoleProfile } from "../../../shared/ipc";
import { buttonClass, inputClass, PageHeader } from "../components/EmptyState";

const PRESET_LABEL: Record<string, string> = {
  devops_sre: "DevOps / SRE",
  developer: "Developer",
  qa: "QA",
  product_owner: "Product owner / Scrum master",
  business_analyst: "Business analyst",
  manager: "Manager",
  custom: "Custom",
};

const list = (s: string) => s.split(/[,\n]/).map((x) => x.trim()).filter(Boolean);

export function ProfilePage() {
  const [p, setP] = useState<RoleProfile | null>(null);
  const [presets, setPresets] = useState<Record<string, RoleProfile>>({});
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    void window.copilot.profile.get().then(setP).catch((e: Error) => setMsg(e.message));
    void window.copilot.profile.presets().then(setPresets).catch(() => setPresets({}));
  }, []);
  if (!p) return <section><PageHeader title="Your role" />{msg && <p className="text-sm">Sign in first ({msg.replace(/^Error invoking remote method '[^']+': (Error: )?/, "")}).</p>}</section>;

  const field = (key: keyof RoleProfile, label: string, opts: { list?: boolean; rows?: number; hint?: string } = {}) => {
    const value = p[key];
    const text = Array.isArray(value) ? value.join(", ") : value;
    const onChange = (v: string) => setP({ ...p, [key]: opts.list ? list(v) : v });
    return (
      <label className="block text-sm">
        {label}
        {opts.rows ? (
          <textarea className={`${inputClass} mt-1`} rows={opts.rows} defaultValue={text} onBlur={(e) => onChange(e.target.value)} />
        ) : (
          <input className={`${inputClass} mt-1`} defaultValue={text} onBlur={(e) => onChange(e.target.value)} />
        )}
        {opts.hint && <span className="mt-0.5 block text-xs text-gray-500 dark:text-gray-400">{opts.hint}</span>}
      </label>
    );
  };

  return (
    <section className="max-w-xl space-y-4">
      <PageHeader title="Your role" />
      <p className="text-sm text-gray-600 dark:text-gray-300">
        This decides which questions count as aimed at you, and the tone of suggested answers. Cards only use facts from
        your meetings and notes.
      </p>
      <label className="block text-sm">
        Start from a preset
        <select
          className={`${inputClass} mt-1`}
          defaultValue=""
          onChange={(e) => {
            const pr = presets[e.target.value];
            if (pr) setP({ ...p, title: pr.title, responsibilities: pr.responsibilities, speaking_style: pr.speaking_style });
          }}
        >
          <option value="">Choose…</option>
          {Object.keys(presets).map((k) => (
            <option key={k} value={k}>{PRESET_LABEL[k] ?? k}</option>
          ))}
        </select>
      </label>
      <div key={`${p.title}|${p.speaking_style}`} className="space-y-4">
        {field("name", "Your name (as people say it)")}
        {field("aliases", "Other names people use", { list: true, hint: "Comma separated, e.g. SK, Sai K" })}
        {field("title", "Role title")}
        {field("responsibilities", "Responsibilities", { rows: 3 })}
        {field("systems_owned", "Systems you own", { list: true, hint: "Questions about these count as aimed at you" })}
        {field("current_tickets", "Current tickets", { list: true })}
        {field("speaking_style", "How you like to speak", { hint: "e.g. brief and direct" })}
      </div>
      <button type="button" className={buttonClass} onClick={() => void window.copilot.profile.put(p).then((saved) => { setP(saved); setMsg("Saved"); }, (e: Error) => setMsg(e.message))}>
        Save
      </button>
      {msg && <p className="text-sm" role="status">{msg}</p>}
    </section>
  );
}
