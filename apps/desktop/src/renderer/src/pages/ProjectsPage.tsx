import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { BoardItem, Project, ProjectDocument, ProjectMember, ProjectRole } from "../../../shared/ipc";
import { buttonClass, EmptyState, inputClass, PageHeader, secondaryButtonClass } from "../components/EmptyState";
import { call, errorText, useProjects } from "../projects/useProjects";

const ROLES: ProjectRole[] = ["owner", "member", "viewer"];

export function ProjectsPage() {
  const { projects, error, reload } = useProjects();
  const [name, setName] = useState("");
  const [note, setNote] = useState<string | null>(null);

  const create = async () => {
    if (!name.trim()) return;
    try {
      await call({ op: "create", name: name.trim() });
      setName("");
      reload();
    } catch (e) {
      setNote(errorText(e));
    }
  };

  return (
    <section className="max-w-3xl">
      <PageHeader title="Projects" />
      <form className="mb-6 flex gap-2" onSubmit={(e) => (e.preventDefault(), void create())}>
        <input className={inputClass} aria-label="New project name" placeholder="New project name" value={name} onChange={(e) => setName(e.target.value)} />
        <button type="submit" className={buttonClass} disabled={!name.trim()}>Create</button>
      </form>
      {(note || error) && <p className="mb-3 text-xs text-red-600">{note ?? error}</p>}
      {projects && projects.length === 0 && !error && (
        <EmptyState title="No projects yet" body="A project shares meetings, key terms, documents and an action-item board with your team." />
      )}
      <ul className="divide-y divide-gray-200 rounded-lg border border-gray-200 dark:divide-gray-800 dark:border-gray-800" aria-label="Projects">
        {projects?.map((p) => (
          <li key={p.id}>
            <Link to={`/projects/${p.id}`} className="flex items-center justify-between px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-900">
              <span className="font-medium">{p.name}</span>
              <span className="text-xs text-gray-500">{p.role}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ProjectDetailPage() {
  const { id = "" } = useParams();
  const [project, setProject] = useState<Project | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    call<Project>({ op: "get", id }).then(setProject, (e) => setError(errorText(e)));
  }, [id]);
  if (error) return <EmptyState title="Can't open this project" body={error} action={<Link to="/projects" className="text-sm underline">Back to projects</Link>} />;
  if (!project) return null;
  const isOwner = project.role === "owner";
  const canWrite = project.role !== "viewer";
  return (
    <section className="max-w-3xl space-y-8">
      <PageHeader title={project.name}>
        <span className="text-xs text-gray-500">You are {project.role === "owner" ? "an owner" : `a ${project.role}`}</span>
      </PageHeader>
      <Members id={id} isOwner={isOwner} />
      <Vocabulary id={id} canWrite={canWrite} />
      <Documents id={id} canWrite={canWrite} />
      <Board id={id} canWrite={canWrite} />
    </section>
  );
}

function Section({ title, children, note }: { title: string; children: React.ReactNode; note?: string | null }) {
  return (
    <div aria-label={title} role="region">
      <h2 className="mb-2 font-medium">{title}</h2>
      {note && <p className="mb-2 text-xs text-red-600">{note}</p>}
      {children}
    </div>
  );
}

/** Loads a list and re-runs actions with error capture. */
function useList<T>(load: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const reload = useCallback(() => void load().then(setData, (e) => setNote(errorText(e))), [load]);
  useEffect(reload, [reload]);
  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      setNote(null);
      reload();
    } catch (e) {
      setNote(errorText(e));
    }
  };
  return { data, note, act };
}

function Members({ id, isOwner }: { id: string; isOwner: boolean }) {
  const { data, note, act } = useList(useCallback(() => call<ProjectMember[]>({ op: "members", id }), [id]));
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<ProjectRole>("member");
  return (
    <Section title="Members" note={note}>
      <ul className="mb-3 space-y-1 text-sm" data-testid="members">
        {data?.map((m) => (
          <li key={m.user_id ?? m.email} className="flex items-center gap-2">
            <span className="flex-1">
              {m.name || m.email || m.user_id}
              {m.pending && <span className="ml-2 text-xs text-gray-500">invited</span>}
            </span>
            {isOwner && m.user_id ? (
              <>
                <select aria-label={`Role for ${m.email ?? m.user_id}`} className={`${inputClass} w-auto`} value={m.role} onChange={(e) => void act(() => call({ op: "setRole", id, userId: m.user_id!, role: e.target.value as ProjectRole }))}>
                  {ROLES.map((r) => <option key={r}>{r}</option>)}
                </select>
                <button type="button" className={secondaryButtonClass} onClick={() => void act(() => call({ op: "removeMember", id, userId: m.user_id! }))}>Remove</button>
              </>
            ) : (
              <span className="text-xs text-gray-500">{m.role}</span>
            )}
          </li>
        ))}
      </ul>
      {isOwner && (
        <form className="flex gap-2" onSubmit={(e) => (e.preventDefault(), void act(() => call({ op: "invite", id, email: email.trim(), role })).then(() => setEmail("")))}>
          <input type="email" className={inputClass} aria-label="Invite by email" placeholder="teammate@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          <select aria-label="Invite role" className={`${inputClass} w-auto`} value={role} onChange={(e) => setRole(e.target.value as ProjectRole)}>
            {ROLES.map((r) => <option key={r}>{r}</option>)}
          </select>
          <button type="submit" className={buttonClass} disabled={!email.includes("@")}>Invite</button>
        </form>
      )}
    </Section>
  );
}

function Vocabulary({ id, canWrite }: { id: string; canWrite: boolean }) {
  const { data, note, act } = useList(useCallback(() => call<{ terms: string[] }>({ op: "vocabulary", id }), [id]));
  const [text, setText] = useState<string | null>(null);
  const value = text ?? data?.terms.join("\n") ?? "";
  return (
    <Section title="Key terms" note={note}>
      <p className="mb-2 text-xs text-gray-500">Names, product words and ticket prefixes. They help transcription in this project's meetings. One per line.</p>
      <textarea aria-label="Key terms" className={inputClass} rows={4} value={value} readOnly={!canWrite} onChange={(e) => setText(e.target.value)} />
      {canWrite && text !== null && (
        <button type="button" className={`${buttonClass} mt-2`} onClick={() => void act(() => call({ op: "setVocabulary", id, terms: text.split("\n").map((t) => t.trim()).filter(Boolean) })).then(() => setText(null))}>
          Save terms
        </button>
      )}
    </Section>
  );
}

function Documents({ id, canWrite }: { id: string; canWrite: boolean }) {
  const { data, note, act } = useList(useCallback(() => call<ProjectDocument[]>({ op: "documents", id }), [id]));
  const [url, setUrl] = useState("");
  return (
    <Section title="Documents" note={note}>
      <p className="mb-2 text-xs text-gray-500">Runbooks, specs and links. Answers in this project's meetings can cite them.</p>
      <ul className="mb-3 space-y-1 text-sm" data-testid="documents">
        {data?.length === 0 && <li className="text-gray-500">No documents yet.</li>}
        {data?.map((d) => (
          <li key={d.id} className="flex items-center gap-2">
            <span className="flex-1 truncate">{d.title}{d.source_url && <span className="ml-2 text-xs text-gray-500">{d.source_url}</span>}</span>
            {canWrite && <button type="button" className={secondaryButtonClass} onClick={() => void act(() => call({ op: "deleteDocument", id, docId: d.id }))}>Delete</button>}
          </li>
        ))}
      </ul>
      {canWrite && (
        <div className="flex gap-2">
          <button type="button" className={secondaryButtonClass} onClick={() => void act(() => call({ op: "uploadDocument", id }))}>Upload file…</button>
          <form className="flex flex-1 gap-2" onSubmit={(e) => (e.preventDefault(), void act(() => call({ op: "addLink", id, url: url.trim() })).then(() => setUrl("")))}>
            <input type="url" className={inputClass} aria-label="Add a link" placeholder="https://wiki.example.com/runbook" value={url} onChange={(e) => setUrl(e.target.value)} />
            <button type="submit" className={secondaryButtonClass} disabled={!/^https?:\/\//.test(url.trim())}>Add link</button>
          </form>
        </div>
      )}
    </Section>
  );
}

function Board({ id, canWrite }: { id: string; canWrite: boolean }) {
  const [filter, setFilter] = useState<"all" | "mine" | "overdue">("all");
  const { data, note, act } = useList(useCallback(() => call<BoardItem[]>({ op: "board", id, filter }), [id, filter]));
  return (
    <Section title="Action items" note={note}>
      <div className="mb-2 flex gap-1 text-xs" role="tablist">
        {(["all", "mine", "overdue"] as const).map((f) => (
          <button key={f} type="button" role="tab" aria-selected={filter === f} className={`rounded px-2 py-1 ${filter === f ? "bg-gray-200 dark:bg-gray-800" : ""}`} onClick={() => setFilter(f)}>
            {f === "all" ? "All" : f === "mine" ? "Mine" : "Overdue"}
          </button>
        ))}
      </div>
      <ul className="space-y-1 text-sm" data-testid="board">
        {data?.length === 0 && <li className="text-gray-500">Nothing here. Action items from shared meetings show up on this board.</li>}
        {data?.map((a) => (
          <li key={a.id} className="flex items-center gap-2">
            <input
              type="checkbox"
              aria-label={`Done: ${a.text}`}
              checked={a.status === "done"}
              disabled={!canWrite}
              onChange={(e) => void act(() => call({ op: "editItem", itemId: a.id, status: e.target.checked ? "done" : "open" }))}
            />
            <span className={`flex-1 ${a.status === "done" ? "text-gray-400 line-through" : ""}`}>
              {a.text}
              <span className="ml-2 text-xs text-gray-500">
                {a.owner ?? "unassigned"}
                {a.due ? ` · due ${a.due}` : ""}
                {a.overdue ? " · overdue" : ""} · <Link className="underline" to={`/meetings/${a.meeting_id}`}>{a.meeting_title}</Link>
              </span>
            </span>
          </li>
        ))}
      </ul>
    </Section>
  );
}
