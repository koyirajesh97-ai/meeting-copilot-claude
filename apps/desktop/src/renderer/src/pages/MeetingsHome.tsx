import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { meetingRoute, type CachedMeeting, type SearchHit, type UpcomingMeeting } from "../../../shared/ipc";
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


  return (
    <section>
      <PageHeader title="Meetings">
        <Link to="/standup" className={secondaryButtonClass}>
          Standup prep
        </Link>
      </PageHeader>
      <input type="search" placeholder="Search your meetings" aria-label="Search meetings" className={`${inputClass} mb-4 py-2`} value={q} onChange={(e) => setQ(e.target.value)} />
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
      <Upcoming />
      {meetings.length === 0 ? (
        <EmptyState
          title="No meetings yet"
          body="Press Start meeting, join your call as usual, and the transcript and summary show up here."
          action={<Link to="/start" className={buttonClass}>Start meeting</Link>}
        />
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

/** Today's calendar (when a calendar is connected): start one with its title, type and agenda. */
function Upcoming() {
  const [events, setEvents] = useState<UpcomingMeeting[]>([]);
  useEffect(() => {
    const load = () => void window.copilot.integrations<UpcomingMeeting[]>({ op: "upcoming" }).then(setEvents, () => setEvents([]));
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, []);
  if (events.length === 0) return null;
  return (
    <div className="mb-6">
      <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">Coming up</h2>
      <ul className="space-y-1" aria-label="Upcoming meetings">
        {events.slice(0, 3).map((e) => (
          <li key={e.id} className="flex items-center justify-between gap-3 rounded-md border border-gray-200 px-3 py-2 text-sm dark:border-gray-800" data-testid="upcoming">
            <span>
              <span className="block font-medium">{e.title}</span>
              <span className="text-xs text-gray-500 dark:text-gray-400">
                {new Date(e.start * 1000).toLocaleTimeString(undefined, { timeStyle: "short" })} · {TYPE_LABEL[e.guessed_type] ?? e.guessed_type}
              </span>
            </span>
            {e.meeting_id ? (
              <Link to={`/meetings/${e.meeting_id}`} className="text-xs underline">Recorded</Link>
            ) : (
              <Link to={`/start?event=${encodeURIComponent(e.id)}`} className={secondaryButtonClass}>Start</Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
