import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { MeetingEvent } from "@meeting-copilot/shared";
import { speakerLabel } from "../../../shared/ipc";
import { PageHeader } from "../components/EmptyState";
import { errorText } from "./useProjects";

interface Line {
  id: string;
  speaker: string;
  text: string;
  final: boolean;
}

/** Watch a teammate's shared meeting: captions only. Their private help (cards) never reaches you. */
export function LiveViewerPage() {
  const { id = "" } = useParams();
  const [lines, setLines] = useState<Line[]>([]);
  const [status, setStatus] = useState("Connecting…");
  const [names, setNames] = useState<Record<string, string>>({});

  useEffect(() => {
    const off = window.copilot.watch.onEvent((e: MeetingEvent) => {
      if (e.type === "transcript.partial" || e.type === "transcript.final") {
        const final = e.type === "transcript.final";
        setStatus("Live");
        setLines((prev) => {
          const key = final ? e.segment_id : `partial-${e.channel}`;
          const rest = prev.filter((l) => l.id !== key && !(final && l.id === `partial-${e.channel}`));
          return [...rest, { id: key, speaker: e.speaker_id, text: e.text, final }];
        });
      } else if (e.type === "speaker.identified") {
        setNames((n) => ({ ...n, [e.speaker_id]: e.display_name }));
      } else if (e.type === "error" && e.code === "watch_closed") {
        setStatus(e.message);
      } else if (e.type === "summary.ready") {
        setStatus("The meeting ended and its summary is ready on the meeting page.");
      }
    });
    window.copilot.watch.start(id).then(
      () => setStatus("Live"),
      (err) => setStatus(`Can't watch: ${errorText(err)}`),
    );
    return () => {
      off();
      void window.copilot.watch.stop();
    };
  }, [id]);

  return (
    <section className="max-w-3xl">
      <PageHeader title="Watching live">
        <Link to={`/meetings/${id}`} className="text-sm underline">Meeting page</Link>
      </PageHeader>
      <p className="-mt-4 mb-4 text-sm text-gray-500 dark:text-gray-400" data-testid="watch-status">{status}</p>
      <ol className="space-y-2 text-sm" aria-label="Live captions">
        {lines.map((l) => (
          <li key={l.id} className={l.final ? "" : "text-gray-400"} data-testid="watch-line">
            <span className="mr-1.5 font-semibold">{speakerLabel(l.speaker, names)}:</span>
            {l.text}
          </li>
        ))}
      </ol>
    </section>
  );
}
