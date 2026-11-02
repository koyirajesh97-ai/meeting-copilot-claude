import { useState } from "react";
import type { CachedMeeting } from "../../../shared/ipc";
import { inputClass } from "../components/EmptyState";
import { errorText, useProjects } from "./useProjects";

/** Owner-only: move a meeting into a project and share it with the members (or make it private). */
export function ShareControl({ meeting }: { meeting: CachedMeeting }) {
  const { projects } = useProjects();
  const [note, setNote] = useState<string | null>(null);
  if (!projects || projects.length === 0) return null;
  const value = meeting.project_id ? `${meeting.project_id}|${meeting.visibility}` : "";
  const change = async (v: string) => {
    const [project_id = "", visibility = "private"] = v.split("|");
    try {
      await window.copilot.editMeeting(meeting.id, { project_id, visibility });
      setNote(null);
    } catch (e) {
      setNote(errorText(e));
    }
  };
  return (
    <span className="flex items-center gap-2">
      <select aria-label="Sharing" className={`${inputClass} w-auto`} value={value} onChange={(e) => void change(e.target.value)}>
        <option value="">Private</option>
        {projects.filter((p) => p.role !== "viewer").map((p) => [
          <option key={`${p.id}p`} value={`${p.id}|private`}>{p.name} (only me)</option>,
          <option key={`${p.id}s`} value={`${p.id}|project`}>{p.name} (shared)</option>,
        ])}
      </select>
      {note && <span className="text-xs text-red-600">{note}</span>}
    </span>
  );
}
