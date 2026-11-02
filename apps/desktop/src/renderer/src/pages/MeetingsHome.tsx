import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { CachedMeeting } from "../../../shared/ipc";
import { MEETING_TYPES } from "../../../shared/meetings";
import { buttonClass, EmptyState, inputClass, PageHeader, secondaryButtonClass } from "../components/EmptyState";

const TYPE_LABEL = Object.fromEntries(MEETING_TYPES.map((t) => [t.id, t.label]));

export function formatWhen(epochS: number): string {
  return new Date(epochS * 1000).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/** Cached meetings, refreshed whenever the main process broadcasts a change. */
export function useCachedMeetings(): CachedMeeting[] {
  const [meetings, setMeetings] = useState<CachedMeeting[]>([]);
  useEffect(() => {
    const load = () => void window.copilot.meetings.list().then(setMeetings);
    load();
    return window.copilot.onState(load);
  }, []);
  return meetings;
}

export function MeetingsHome() {
  const meetings = useCachedMeetings();
  const [q, setQ] = useState("");
  const [syncNote, setSyncNote] = useState<string | null>(null);
  const shown = meetings.filter((m) => m.title.toLowerCase().includes(q.trim().toLowerCase()));

  const sync = async () => {
    const r = await window.copilot.meetings.sync();
    setSyncNote(r.error ? `Couldn't sync: ${r.error}` : `Synced ${r.meetings} meeting(s)`);
  };

  return (
    <section>
      <PageHeader title="Meetings">
        <div className="flex gap-2">
          <button type="button" className={secondaryButtonClass} onClick={() => void sync()}>
            Sync
          </button>
          <Link to="/start" className={buttonClass}>
            Start meeting
          </Link>
        </div>
      </PageHeader>
      {syncNote && <p className="mb-3 text-xs text-gray-500 dark:text-gray-400">{syncNote}</p>}
      <input type="search" placeholder="Filter by title" aria-label="Filter meetings" className={`${inputClass} mb-6`} value={q} onChange={(e) => setQ(e.target.value)} />
      {meetings.length === 0 ? (
        <EmptyState title="No meetings yet" body="Start a meeting and its transcript will show up here, even when you're offline." />
      ) : (
        <ul className="divide-y divide-gray-200 rounded-lg border border-gray-200 dark:divide-gray-800 dark:border-gray-800" aria-label="Meetings">
          {shown.map((m) => (
            <li key={m.id}>
              <Link to={`/meetings/${m.id}`} className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-900">
                <span>
                  <span className="block font-medium">{m.title}</span>
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    {formatWhen(m.started_at)} · {TYPE_LABEL[m.type] ?? m.type}
                    {m.ended_at === null ? " · in progress" : ""}
                  </span>
                </span>
                <span className="shrink-0 text-xs text-gray-500 dark:text-gray-400">{m.segment_count} lines</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
