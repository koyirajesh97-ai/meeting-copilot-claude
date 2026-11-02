import { useCallback, useEffect, useState } from "react";
import type { Project, ProjectCall } from "../../../shared/ipc";

export const call = <T,>(c: ProjectCall) => window.copilot.projects<T>(c);

/** Strip Electron's "Error invoking remote method" prefix for display. */
export function errorText(err: unknown): string {
  return (err as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
}

/** Your projects; null while loading, and an error when offline or signed out. */
export function useProjects(): { projects: Project[] | null; error: string | null; reload: () => void } {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(() => {
    call<Project[]>({ op: "list" })
      .then((p) => {
        setProjects(p);
        setError(null);
      })
      .catch((e) => {
        setProjects([]);
        setError(errorText(e));
      });
  }, []);
  useEffect(reload, [reload]);
  return { projects, error, reload };
}
