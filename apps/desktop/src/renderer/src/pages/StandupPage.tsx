import { useEffect, useState } from "react";
import type { StandupEntry } from "../../../shared/ipc";
import { buttonClass, inputClass, PageHeader, secondaryButtonClass } from "../components/EmptyState";

const lines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);

export function StandupPage() {
  const [notes, setNotes] = useState("");
  const [entry, setEntry] = useState<StandupEntry | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    void window.copilot.standup.today().then((e) => {
      if (e) {
        setEntry(e);
        setNotes(e.notes);
      }
    }).catch(() => undefined);
  }, []);

  const run = async (fn: () => Promise<StandupEntry>, ok: string) => {
    setBusy(true);
    setMsg(null);
    try {
      setEntry(await fn());
      setMsg(ok);
    } catch (err) {
      setMsg((err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ""));
    } finally {
      setBusy(false);
    }
  };

  const listField = (key: "done" | "doing" | "blockers", label: string) =>
    entry && (
      <label className="block text-sm">
        {label} (one per line)
        <textarea
          key={`${entry.id}-${key}-${entry[key].join("|")}`}
          className={`${inputClass} mt-1`}
          rows={3}
          defaultValue={entry[key].join("\n")}
          onBlur={(e) => setEntry({ ...entry, [key]: lines(e.target.value) })}
          data-testid={`standup-${key}`}
        />
      </label>
    );

  return (
    <section className="max-w-2xl space-y-4">
      <PageHeader title="Standup prep" />
      <label className="block text-sm">
        Rough notes: what you did, what's next, what's blocking you
        <textarea
          className={`${inputClass} mt-1`}
          rows={5}
          placeholder={"finished OPS-142 cert renewal\ntoday: prod deploy\nblocked on VPN access"}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          aria-label="Standup notes"
        />
      </label>
      <button type="button" className={buttonClass} disabled={busy || !notes.trim()} onClick={() => void run(() => window.copilot.standup.generate(notes), "Ready. In a standup meeting, this card comes up when your name is called.")}>
        {busy ? "Writing…" : entry ? "Regenerate" : "Make my update"}
      </button>
      {entry && (
        <div className="space-y-3 rounded-md border border-gray-200 p-4 dark:border-gray-800" data-testid="standup-entry">
          {listField("done", "Done")}
          {listField("doing", "Doing")}
          {listField("blockers", "Blockers")}
          <label className="block text-sm">
            30-second script
            <textarea
              key={`${entry.id}-script-${entry.script}`}
              className={`${inputClass} mt-1`}
              rows={4}
              defaultValue={entry.script}
              onBlur={(e) => setEntry({ ...entry, script: e.target.value })}
              data-testid="standup-script"
            />
            <span className="text-xs text-gray-500">{entry.script.split(/\s+/).filter(Boolean).length} words (about 75 is 30 seconds)</span>
          </label>
          <button type="button" className={secondaryButtonClass} disabled={busy} onClick={() => void run(() => window.copilot.standup.save(entry), "Saved")}>
            Save edits
          </button>
        </div>
      )}
      {msg && <p className="text-sm" role="status">{msg}</p>}
    </section>
  );
}
