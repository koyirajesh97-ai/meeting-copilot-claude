import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { speakerLabel, type CachedMeetingDetail, type IntegrationInfo } from "../../../shared/ipc";
import { buttonClass, EmptyState, inputClass, PageHeader, secondaryButtonClass } from "../components/EmptyState";
import { MenuItem } from "../components/Menu";
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
  // The transcript is folded away unless you came from a citation to a moment in it.
  const [showTranscript, setShowTranscript] = useState(at !== null);
  const [deleting, setDeleting] = useState(false);
  const [postTo, setPostTo] = useState<"slack" | "teams" | null>(null);
  const targets = usePostTargets();

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
  const name = (t: string) => (t === "slack" ? "Slack" : "Teams");
  const menu = (
    <>
      {meeting.summary.status === "ready" &&
        targets.map((t) => (
          <MenuItem key={t} onClick={() => setPostTo(t)}>
            Post to {name(t)}…
          </MenuItem>
        ))}
      {meeting.is_mine && (
        <div className="px-3 py-2">
          <span className="mb-1 block text-xs text-gray-500">Who can see it</span>
          <ShareControl meeting={meeting} />
        </div>
      )}
      {meeting.is_mine && (
        <MenuItem danger onClick={() => setDeleting(true)}>
          Delete meeting…
        </MenuItem>
      )}
    </>
  );
  return (
    <section className="max-w-3xl">
      <header className="mb-6">
        <div className="flex items-start justify-between gap-4">
          <h1 className="text-2xl font-semibold">{meeting.title}</h1>
          {!meeting.is_mine && meeting.ended_at === null && (
            <Link to={`/meetings/${meeting.id}/live`} className={buttonClass}>Watch live</Link>
          )}
        </div>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          {formatWhen(meeting.started_at)}
          {meeting.ended_at ? ` – ${new Date(meeting.ended_at * 1000).toLocaleTimeString(undefined, { timeStyle: "short" })}` : " · in progress"}
          {!meeting.is_mine && " · shared with you (read-only)"}
        </p>
      </header>
      {deleting && <DeleteMeeting id={meeting.id} onCancel={() => setDeleting(false)} />}
      <SummaryPanel meeting={meeting} extra={menu} />
      {postTo && <PostSummary meetingId={meeting.id} target={postTo} onDone={() => setPostTo(null)} />}
      <section aria-label="Transcript" className="border-t border-gray-200 pt-4 dark:border-gray-800">
        <button type="button" className="text-sm font-medium" aria-expanded={showTranscript} onClick={() => setShowTranscript(!showTranscript)}>
          {showTranscript ? "▾" : "▸"} Transcript ({meeting.transcript.length} lines)
        </button>
        {showTranscript &&
          (meeting.transcript.length === 0 ? (
            <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">No transcript yet.</p>
          ) : (
            <ol className="mt-3 space-y-2 text-sm">
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
          ))}
      </section>
    </section>
  );
}

/** Asked from the More menu: "Delete for good" removes the server copy, the cache and the WAVs. */
function DeleteMeeting({ id, onCancel }: { id: string; onCancel: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  return (
    <div className="mb-6 flex flex-wrap items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm dark:border-red-900 dark:bg-red-950/40">
      <span className="flex-1">{error ?? "Delete this meeting? The transcript, summary and audio are removed for good."}</span>
      <button
        type="button"
        className={`${buttonClass} bg-red-600 hover:bg-red-700`}
        onClick={() =>
          void window.copilot.privacy.deleteMeeting(id).then(
            () => navigate("/"),
            (e: Error) => setError(e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "")),
          )
        }
      >
        Delete for good
      </button>
      <button type="button" className={secondaryButtonClass} onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}

/** Slack / Teams channels you've connected (Settings → Connections). */
function usePostTargets(): ("slack" | "teams")[] {
  const [targets, setTargets] = useState<("slack" | "teams")[]>([]);
  useEffect(() => {
    void window.copilot
      .integrations<IntegrationInfo[]>({ op: "list" })
      .then((l) => setTargets(l.filter((i) => (i.kind === "slack" || i.kind === "teams") && i.enabled && i.connected).map((i) => i.kind as "slack")), () => setTargets([]));
  }, []);
  return targets;
}

/** Post the summary to Slack or Teams: always shows the exact text first; nothing is sent until you confirm. */
function PostSummary({ meetingId, target, onDone }: { meetingId: string; target: "slack" | "teams"; onDone: () => void }) {
  const [preview, setPreview] = useState<{ target: "slack" | "teams"; text: string; preview_token: string } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const name = target === "slack" ? "Slack" : "Teams";
  const err = (e: unknown) => setNote((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ""));
  useEffect(() => {
    setPreview(null);
    setNote(null);
    void window.copilot.integrations<{ target: "slack" | "teams"; text: string; preview_token: string }>({ op: "preview", meetingId, target }).then(setPreview, err);
  }, [meetingId, target]);
  return (
    <div className="mb-6 space-y-2 rounded-lg border border-gray-200 p-3 dark:border-gray-800" data-testid="post-summary">
      {preview && (
        <>
          <p className="text-sm font-medium">This is what will be posted to {name}. Edit it if you like.</p>
          <textarea aria-label="Post preview" className={inputClass} rows={10} value={preview.text} onChange={(e) => setPreview({ ...preview, text: e.target.value })} />
          <div className="flex gap-2">
            <button
              type="button"
              className={buttonClass}
              onClick={() =>
                void window.copilot
                  .integrations({ op: "post", meetingId, target, text: preview.text, previewToken: preview.preview_token })
                  .then(() => (setPreview(null), setNote(`Posted to ${name}.`)), err)
              }
            >
              Post to {name}
            </button>
            <button type="button" className={secondaryButtonClass} onClick={onDone}>
              Cancel
            </button>
          </div>
        </>
      )}
      {note && (
        <p role="status" className="flex items-center justify-between text-sm text-gray-600 dark:text-gray-300">
          {note}
          <button type="button" className="text-xs underline" onClick={onDone}>Close</button>
        </p>
      )}
    </div>
  );
}
