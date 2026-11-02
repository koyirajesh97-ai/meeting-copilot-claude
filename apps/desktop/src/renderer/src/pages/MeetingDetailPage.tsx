import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { speakerLabel, type CachedMeetingDetail } from "../../../shared/ipc";
import { EmptyState, PageHeader } from "../components/EmptyState";
import { formatWhen } from "./MeetingsHome";

function clock(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export function MeetingDetailPage() {
  const { id = "" } = useParams();
  const [meeting, setMeeting] = useState<CachedMeetingDetail | null | undefined>(undefined);
  useEffect(() => {
    const load = () => void window.copilot.meetings.get(id).then(setMeeting);
    load();
    return window.copilot.onState(load);
  }, [id]);

  if (meeting === undefined) return null;
  if (meeting === null) {
    return (
      <section>
        <PageHeader title="Meeting" />
        <EmptyState title="Meeting not found" body="It may not have synced to this computer yet." action={<Link to="/" className="text-sm underline">Back to meetings</Link>} />
      </section>
    );
  }
  return (
    <section className="max-w-3xl">
      <PageHeader title={meeting.title} />
      <p className="-mt-4 mb-6 text-sm text-gray-500 dark:text-gray-400">
        {formatWhen(meeting.started_at)}
        {meeting.ended_at ? ` – ${new Date(meeting.ended_at * 1000).toLocaleTimeString(undefined, { timeStyle: "short" })}` : " · in progress"}
      </p>
      <h2 className="mb-2 font-medium">Transcript</h2>
      {meeting.transcript.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">No transcript yet.</p>
      ) : (
        <ol className="space-y-2 text-sm" aria-label="Transcript">
          {meeting.transcript.map((s) => (
            <li key={s.segment_id} className="flex gap-3" data-testid="transcript-line">
              <span className="w-12 shrink-0 font-mono text-xs text-gray-400">{clock(s.start_ms)}</span>
              <span>
                <span className="mr-1.5 font-semibold">{speakerLabel(s.speaker_id)}:</span>
                {s.text}
              </span>
            </li>
          ))}
        </ol>
      )}
      <p className="mt-8 text-xs text-gray-500 dark:text-gray-400">Summary, action items and speaker renaming arrive in Prompt 7.</p>
    </section>
  );
}
