import { useState } from "react";
import type { CachedMeetingDetail } from "../../../shared/ipc";
import { MEETING_TYPES } from "../../../shared/meetings";
import { buttonClass, inputClass, secondaryButtonClass } from "../components/EmptyState";
import { fromEditable, toEditable, type EditableSummary } from "./edit";

function List({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <h3 className="mb-1 text-sm font-medium">{title}</h3>
      {items.length ? (
        <ul className="list-disc space-y-0.5 pl-5 text-sm">
          {items.map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-gray-400">None</p>
      )}
    </div>
  );
}

function Field({ label, value, onChange, rows = 3 }: { label: string; value: string; onChange: (v: string) => void; rows?: number }) {
  return (
    <label className="block text-sm">
      <span className="font-medium">{label}</span>
      <textarea className={`${inputClass} mt-1 font-mono text-xs`} rows={rows} value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

export function SummaryPanel({ meeting }: { meeting: CachedMeetingDetail }) {
  const { summary } = meeting;
  const [editing, setEditing] = useState<EditableSummary | null>(null);
  const [template, setTemplate] = useState(summary.template ?? meeting.type);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const act = async (fn: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    setNote(null);
    try {
      await fn();
      if (done) setNote(done);
    } catch (err) {
      setNote((err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ""));
    } finally {
      setBusy(false);
    }
  };

  const toolbar = (
    <div className="flex flex-wrap items-center gap-2">
      <select aria-label="Template" className={`${inputClass} w-auto`} value={template} onChange={(e) => setTemplate(e.target.value)}>
        {MEETING_TYPES.map((t) => (
          <option key={t.id} value={t.id}>
            {t.label}
          </option>
        ))}
      </select>
      <button type="button" className={secondaryButtonClass} disabled={busy || summary.status === "pending"} onClick={() => void act(() => window.copilot.meetings.regenerate(meeting.id, template))}>
        Regenerate
      </button>
      {summary.data && !editing && (
        <>
          <button type="button" className={secondaryButtonClass} onClick={() => setEditing(toEditable(summary.data!))}>
            Edit
          </button>
          <button type="button" className={secondaryButtonClass} disabled={busy} onClick={() => void act(async () => {
            await navigator.clipboard.writeText(await window.copilot.meetings.markdown(meeting.id, false));
          }, "Copied the summary. Paste it into an email, Teams or Slack.")}>
            Copy summary
          </button>
          <button type="button" className={secondaryButtonClass} disabled={busy} onClick={() => void act(async () => {
            const path = await window.copilot.meetings.exportMarkdown(meeting.id);
            if (path) setNote(`Saved to ${path}`);
          })}>
            Export Markdown
          </button>
        </>
      )}
    </div>
  );

  let body;
  if (summary.status === "pending") {
    body = <p className="text-sm text-gray-500" data-testid="summary-pending">Summarizing… this usually takes under a minute.</p>;
  } else if (summary.status === "failed" && !summary.data) {
    body = <p className="text-sm text-red-600" role="alert">The summary failed: {summary.error}. Try Regenerate.</p>;
  } else if (!summary.data) {
    body = <p className="text-sm text-gray-500">No summary yet.</p>;
  } else if (editing) {
    const set = (patch: Partial<EditableSummary>) => setEditing({ ...editing, ...patch });
    body = (
      <div className="space-y-3" data-testid="summary-editor">
        <Field label="Overview" value={editing.overview} onChange={(v) => set({ overview: v })} />
        {summary.data.sections.map((s) => (
          <Field key={s.key} label={`${s.title} (one per line)`} value={editing.sections[s.key] ?? ""} onChange={(v) => set({ sections: { ...editing.sections, [s.key]: v } })} />
        ))}
        <Field label="Decisions (text | why)" value={editing.decisions} onChange={(v) => set({ decisions: v })} />
        <Field label="Action items (text | owner | due)" value={editing.action_items} onChange={(v) => set({ action_items: v })} rows={5} />
        <Field label="Takeaways" value={editing.takeaways} onChange={(v) => set({ takeaways: v })} />
        <Field label="Blockers" value={editing.blockers} onChange={(v) => set({ blockers: v })} />
        <Field label="Open questions" value={editing.open_questions} onChange={(v) => set({ open_questions: v })} />
        <div className="flex gap-2">
          <button type="button" className={buttonClass} disabled={busy} onClick={() => void act(async () => {
            await window.copilot.meetings.saveSummary(meeting.id, fromEditable(editing, summary.data!));
            setEditing(null);
          }, "Saved")}>
            Save
          </button>
          <button type="button" className={secondaryButtonClass} onClick={() => setEditing(null)}>
            Cancel
          </button>
        </div>
      </div>
    );
  } else {
    const d = summary.data;
    body = (
      <div className="space-y-4" data-testid="summary">
        {d.overview && <p className="text-sm">{d.overview}</p>}
        {d.sections.map((s) => (
          <List key={s.key} title={s.title} items={s.items} />
        ))}
        {d.per_person.map((p) => (
          <div key={p.person} className="rounded-md border border-gray-200 p-3 dark:border-gray-800">
            <h3 className="mb-2 font-medium">{p.person}</h3>
            <div className="grid gap-3 sm:grid-cols-3">
              <List title="Done" items={p.done} />
              <List title="Doing" items={p.doing} />
              <List title="Blockers" items={p.blockers} />
            </div>
          </div>
        ))}
        <List title="Decisions" items={d.decisions.map((x) => (x.rationale ? `${x.text} (${x.rationale})` : x.text))} />
        <div>
          <h3 className="mb-1 text-sm font-medium">Action items</h3>
          {meeting.action_items.length ? (
            <ul className="space-y-1 text-sm" data-testid="action-items">
              {meeting.action_items.map((a) => (
                <li key={a.id} className="flex gap-2">
                  <span aria-hidden>☐</span>
                  <span>
                    {a.text}
                    {(a.owner || a.due) && (
                      <span className="text-gray-500 dark:text-gray-400"> — {[a.owner, a.due && `due ${a.due}`].filter(Boolean).join(", ")}</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-gray-400">None</p>
          )}
        </div>
        {d.takeaways.length > 0 && <List title="Takeaways" items={d.takeaways} />}
        <List title="Blockers" items={d.blockers} />
        <List title="Open questions" items={d.open_questions} />
      </div>
    );
  }

  return (
    <section className="mb-8 space-y-3" aria-label="Summary">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-medium">Summary</h2>
        {toolbar}
      </div>
      {note && <p className="text-xs text-gray-500 dark:text-gray-400" role="status">{note}</p>}
      {body}
    </section>
  );
}
