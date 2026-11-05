import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { meetingRoute, type CachedMeeting, type SearchHit, type UpcomingMeeting } from "../../../shared/ipc";
import { MEETING_TYPES } from "../../../shared/meetings";
import { CalendarClock, ChevronRight, ClipboardList, Mic, Search } from "lucide-react";
import { buttonClass, cardClass, EmptyState, inputClass, secondaryButtonClass } from "../components/EmptyState";
import { TypeTile } from "../components/meetingTypes";
import { greeting, relativeTime, timeUntil } from "../format";

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
  const [name, setName] = useState("");
  useEffect(() => {
    window.copilot.profile.get().then((p) => setName(p.name.split(" ")[0] ?? ""), () => setName(""));
  }, []);

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
      <header className="mb-8 flex items-end justify-between gap-4">
        <div>
          <p className="text-sm text-slate-500 dark:text-slate-400" data-testid="greeting">
            {greeting()}
            {name ? `, ${name}` : ""} · {new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
          </p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">Meetings</h1>
        </div>
        <Link to="/standup" className={secondaryButtonClass}>
          <ClipboardList size={16} aria-hidden />
          Standup prep
        </Link>
      </header>

      <div className="relative mb-8">
        <Search size={17} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden />
        <input
          type="search"
          placeholder="Search everything that was said"
          aria-label="Search meetings"
          className={`${inputClass} rounded-xl py-3 pl-10 text-[15px]`}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      {searchError && <p className="-mt-6 mb-6 text-xs text-slate-500 dark:text-slate-400">{searchError}</p>}
      {hits && (
        <div className="mb-8">
          <h2 className="mb-3 text-sm font-medium">{hits.length ? `Results for "${q.trim()}"` : `Nothing found for "${q.trim()}"`}</h2>
          <ul className="space-y-2" aria-label="Search results">
            {hits.map((h, i) => (
              <li key={i}>
                <Link to={meetingRoute(h.meeting_id, h.start_ms)} className={`${cardClass} block p-4 transition hover:border-indigo-200 hover:shadow-md`} data-testid="search-hit">
                  <span className="block text-sm font-medium">{h.title}</span>
                  <span className="mt-1 line-clamp-2 text-sm text-slate-500 dark:text-slate-400">{h.text}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Upcoming />

      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Recent</h2>
        {meetings.length > 0 && <span className="text-xs text-slate-400">{meetings.length} meeting{meetings.length === 1 ? "" : "s"}</span>}
      </div>
      {meetings.length === 0 ? (
        <EmptyState
          icon={<Mic size={20} aria-hidden />}
          title="No meetings yet"
          body="Press Start meeting, join your call as usual, and the transcript and summary show up here."
          action={<Link to="/start" className={buttonClass}>Start meeting</Link>}
        />
      ) : (
        <ul className={`${cardClass} divide-y divide-slate-100 overflow-hidden dark:divide-slate-800`} aria-label="Meetings">
          {shown.map((m) => (
            <li key={m.id} className="flex items-center">
              <Link to={`/meetings/${m.id}`} className="group flex flex-1 items-center gap-4 px-5 py-4 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/60">
                <TypeTile type={m.type} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{m.title}</span>
                  <span className="text-sm text-slate-500 dark:text-slate-400" title={formatWhen(m.started_at)}>
                    {TYPE_LABEL[m.type] ?? m.type} · {relativeTime(m.started_at)}
                  </span>
                </span>
                {m.ended_at === null && (
                  <span className="flex items-center gap-1.5 rounded-full bg-red-50 px-2.5 py-1 text-xs font-medium text-red-600 dark:bg-red-950/50 dark:text-red-300">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" aria-hidden />
                    Live
                  </span>
                )}
                {!m.is_mine && (
                  <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700 dark:bg-indigo-950 dark:text-indigo-200" data-testid="shared-badge">
                    Shared
                  </span>
                )}
                <ChevronRight size={18} className="text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-slate-500" aria-hidden />
              </Link>
              {!m.is_mine && m.is_live && (
                <Link to={`/meetings/${m.id}/live`} className="shrink-0 px-4 text-xs font-medium text-indigo-600 underline">
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

/** Your calendar (when connected): the next meeting as a card you can start, then the rest. */
function Upcoming() {
  const [events, setEvents] = useState<UpcomingMeeting[]>([]);
  useEffect(() => {
    const load = () => void window.copilot.integrations<UpcomingMeeting[]>({ op: "upcoming" }).then(setEvents, () => setEvents([]));
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, []);
  if (events.length === 0) return null;
  const [next, ...rest] = events.slice(0, 3);
  const start = (e: UpcomingMeeting, primary: boolean) =>
    e.meeting_id ? (
      <Link to={`/meetings/${e.meeting_id}`} className="text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-300">Recorded</Link>
    ) : (
      <Link to={`/start?event=${encodeURIComponent(e.id)}`} className={primary ? buttonClass : secondaryButtonClass}>
        {primary && <Mic size={15} aria-hidden />}
        Start
      </Link>
    );
  const when = (e: UpcomingMeeting) => new Date(e.start * 1000).toLocaleTimeString(undefined, { timeStyle: "short" });
  return (
    <div className="mb-10" aria-label="Upcoming meetings" role="region">
      <div
        className="relative overflow-hidden rounded-2xl border border-indigo-100 bg-gradient-to-br from-indigo-50 via-white to-violet-50 p-6 shadow-sm dark:border-indigo-900/60 dark:from-indigo-950/60 dark:via-slate-900 dark:to-violet-950/40"
        data-testid="upcoming"
      >
        <div className="flex items-center gap-5">
          <TypeTile type={next.guessed_type} size="lg" />
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-indigo-600 dark:text-indigo-300">
              <CalendarClock size={14} aria-hidden />
              Next up · {timeUntil(next.start)}
            </p>
            <p className="mt-1 truncate text-lg font-semibold tracking-tight">{next.title}</p>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {when(next)} · {TYPE_LABEL[next.guessed_type] ?? next.guessed_type}
              {next.attendees ? ` · ${next.attendees} people` : ""}
            </p>
          </div>
          {start(next, true)}
        </div>
      </div>
      {rest.length > 0 && (
        <ul className="mt-3 grid gap-3 sm:grid-cols-2">
          {rest.map((e) => (
            <li key={e.id} className={`${cardClass} flex items-center gap-3 px-4 py-3`} data-testid="upcoming">
              <TypeTile type={e.guessed_type} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{e.title}</span>
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  {when(e)} · {TYPE_LABEL[e.guessed_type] ?? e.guessed_type}
                </span>
              </span>
              {start(e, false)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
