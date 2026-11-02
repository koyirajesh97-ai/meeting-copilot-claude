import { useEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { speakerLabel, type CachedMeetingDetail } from "../../../shared/ipc";
import { buttonClass, EmptyState, inputClass, PageHeader } from "../components/EmptyState";
import { ShareControl } from "../projects/ShareControl";
import { SummaryPanel } from "../summary/SummaryPanel";
import { formatWhen } from "./MeetingsHome";

function clock(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function SpeakerName({ meeting, id }: { meeting: CachedMeetingDetail; id: string }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const label = speakerLabel(id, meeting.speaker_names);
  if (!id.startsWith("spk_") || !meeting.is_mine) return <span className="mr-1.5 font-semibold">{label}:</span>;
  if (editing) {
    return (
      <form
        className="mr-1.5 inline"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) void window.copilot.meetings.renameSpeaker(meeting.id, id, name.trim());
          setEditing(false);
        }}
      >
        <input autoFocus aria-label={`Name for ${label}`} className={`${inputClass} inline w-36 py-0.5`} value={name} onChange={(e) => setName(e.target.value)} onBlur={() => setEditing(false)} />
      </form>
    );
  }
  return (
    <button type="button" title="Rename this speaker (for this meeting only)" className="mr-1.5 font-semibold underline decoration-dotted underline-offset-2" onClick={() => { setName(meeting.speaker_names[id] ?? ""); setEditing(true); }}>
      {label}:
    </button>
  );
}

export function MeetingDetailPage() {
  const { id = "" } = useParams();
  const [params] = useSearchParams();
  const at = params.get("t") === null ? null : Number(params.get("t"));
  const [meeting, setMeeting] = useState<CachedMeetingDetail | null | undefined>(undefined);
  const target = useRef<HTMLLIElement | null>(null);

  useEffect(() => {
    const load = () => void window.copilot.meetings.get(id).then(setMeeting);
    load();
    return window.copilot.onState(load);
  }, [id]);

  // A citation link (?t=ms) scrolls to the line said at that moment.
  useEffect(() => {
    target.current?.scrollIntoView({ block: "center" });
  }, [meeting?.transcript.length, at]);

  if (meeting === undefined) return null;
  if (meeting === null) {
    return (
      <section>
        <PageHeader title="Meeting" />
        <EmptyState title="Meeting not found" body="It may not have synced to this computer yet." action={<Link to="/" className="text-sm underline">Back to meetings</Link>} />
      </section>
    );
  }
  const highlight = at === null ? null : [...meeting.transcript].reverse().find((s) => s.start_ms <= at)?.segment_id ?? meeting.transcript[0]?.segment_id;
  return (
    <section className="max-w-3xl">
      <PageHeader title={meeting.title}>
        <div className="flex items-center gap-2">
          {!meeting.is_mine && <span className="rounded bg-indigo-100 px-2 py-0.5 text-xs text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200">Shared · read-only</span>}
          {!meeting.is_mine && meeting.ended_at === null && (
            <Link to={`/meetings/${meeting.id}/live`} className={buttonClass}>Watch live</Link>
          )}
          {meeting.is_mine && <ShareControl meeting={meeting} />}
        </div>
      </PageHeader>
      <p className="-mt-4 mb-6 text-sm text-gray-500 dark:text-gray-400">
        {formatWhen(meeting.started_at)}
        {meeting.ended_at ? ` – ${new Date(meeting.ended_at * 1000).toLocaleTimeString(undefined, { timeStyle: "short" })}` : " · in progress"}
      </p>
      <SummaryPanel meeting={meeting} />
      <h2 className="mb-2 font-medium">Transcript</h2>
      {meeting.transcript.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">No transcript yet.</p>
      ) : (
        <ol className="space-y-2 text-sm" aria-label="Transcript">
          {meeting.transcript.map((s) => (
            <li
              key={s.segment_id}
              ref={s.segment_id === highlight ? target : undefined}
              className={`flex gap-3 rounded ${s.segment_id === highlight ? "bg-yellow-100 dark:bg-yellow-900/40" : ""}`}
              data-testid="transcript-line"
              data-highlight={s.segment_id === highlight}
            >
              <span className="w-12 shrink-0 font-mono text-xs text-gray-400">{clock(s.start_ms)}</span>
              <span>
                <SpeakerName meeting={meeting} id={s.speaker_id} />
                {s.text}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
