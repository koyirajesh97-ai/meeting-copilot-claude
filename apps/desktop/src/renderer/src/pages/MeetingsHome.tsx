import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { meetingRoute, type CachedMeeting, type SearchHit } from "../../../shared/ipc";
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
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);

  // Full-text + semantic search on the backend, debounced; offline, the title filter still works.
  useEffect(() => {
    const query = q.trim();
    if (query.length < 3) {
      setHits(null);
      setSearchError(null);
      return;
    }
    const t = setTimeout(() => {
      window.copilot
        .search(query)
        .then((h) => {
          setHits(h);
          setSearchError(null);
        })
        .catch(() => {
          setHits(null);
          setSearchError("Search needs a connection; showing title matches.");
        });
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

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
      <input type="search" placeholder="Search everything that was said" aria-label="Search meetings" className={`${inputClass} mb-2`} value={q} onChange={(e) => setQ(e.target.value)} />
      {searchError && <p className="mb-2 text-xs text-gray-500 dark:text-gray-400">{searchError}</p>}
      {hits && (
        <div className="mb-6">
          <h2 className="mb-2 text-sm font-medium">{hits.length ? `Results for "${q.trim()}"` : `Nothing found for "${q.trim()}"`}</h2>
          <ul className="space-y-2" aria-label="Search results">
            {hits.map((h, i) => (
              <li key={i}>
                <Link to={meetingRoute(h.meeting_id, h.start_ms)} className="block rounded-md border border-gray-200 p-3 hover:bg-gray-50 dark:border-gray-800 dark:hover:bg-gray-900" data-testid="search-hit">
                  <span className="block text-sm font-medium">{h.title}</span>
                  <span className="line-clamp-2 text-xs text-gray-500 dark:text-gray-400">{h.text}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="mb-4" />
      {meetings.length === 0 ? (
        <EmptyState title="No meetings yet" body="Start a meeting and its transcript will show up here, even when you're offline." />
      ) : (
        <ul className="divide-y divide-gray-200 rounded-lg border border-gray-200 dark:divide-gray-800 dark:border-gray-800" aria-label="Meetings">
          {shown.map((m) => (
            <li key={m.id} className="flex items-center">
              <Link to={`/meetings/${m.id}`} className="flex flex-1 items-center justify-between gap-4 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-900">
                <span>
                  <span className="block font-medium">{m.title}</span>
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    {formatWhen(m.started_at)} · {TYPE_LABEL[m.type] ?? m.type}
                    {m.ended_at === null ? " · in progress" : ""}
                  </span>
                </span>
                {!m.is_mine && (
                  <span className="shrink-0 rounded bg-indigo-100 px-2 py-0.5 text-xs text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200" data-testid="shared-badge">
                    Shared
                  </span>
                )}

                <span className="shrink-0 text-xs text-gray-500 dark:text-gray-400">{m.segment_count} lines</span>
              </Link>
              {!m.is_mine && m.is_live && (
                <Link to={`/meetings/${m.id}/live`} className="shrink-0 px-4 text-xs font-medium text-blue-600 underline">
                  Watch live
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
