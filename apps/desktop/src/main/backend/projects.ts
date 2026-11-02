// Maps each Projects-screen action to one backend route. Paths are built here from validated
// ids, so a renderer can't reach arbitrary backend routes.

import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import type { ProjectCall } from "../../shared/ipc";
import type { BackendClient } from "./client";

const id = (v: unknown): string => {
  if (typeof v !== "string" || !/^[\w-]{1,64}$/.test(v)) throw new Error("Bad id");
  return encodeURIComponent(v);
};

export async function projectCall(
  backend: BackendClient,
  call: ProjectCall,
  pickFile: () => Promise<string | null>,
): Promise<unknown> {
  switch (call.op) {
    case "list":
      return backend.call("GET", "/projects");
    case "create":
      return backend.call("POST", "/projects", { name: call.name, description: call.description ?? "" });
    case "get":
      return backend.call("GET", `/projects/${id(call.id)}`);
    case "edit":
      return backend.call("PATCH", `/projects/${id(call.id)}`, { name: call.name, description: call.description });
    case "delete":
      return backend.call("DELETE", `/projects/${id(call.id)}`);
    case "members":
      return backend.call("GET", `/projects/${id(call.id)}/members`);
    case "invite":
      return backend.call("POST", `/projects/${id(call.id)}/members`, { email: call.email, role: call.role });
    case "setRole":
      return backend.call("PATCH", `/projects/${id(call.id)}/members/${id(call.userId)}`, { role: call.role });
    case "removeMember":
      return backend.call("DELETE", `/projects/${id(call.id)}/members/${id(call.userId)}`);
    case "vocabulary":
      return backend.call("GET", `/projects/${id(call.id)}/vocabulary`);
    case "setVocabulary":
      return backend.call("PUT", `/projects/${id(call.id)}/vocabulary`, { terms: call.terms });
    case "documents":
      return backend.call("GET", `/projects/${id(call.id)}/documents`);
    case "uploadDocument": {
      const path = await pickFile();
      if (!path) return null;
      const form = new FormData();
      form.set("file", new Blob([new Uint8Array(await readFile(path))]), basename(path));
      return backend.upload(`/projects/${id(call.id)}/documents`, form);
    }
    case "addLink":
      return backend.call("POST", `/projects/${id(call.id)}/links`, { url: call.url, title: call.title || null });
    case "deleteDocument":
      return backend.call("DELETE", `/projects/${id(call.id)}/documents/${id(call.docId)}`);
    case "board":
      return backend.call("GET", `/action-items?project_id=${id(call.id)}&filter=${encodeURIComponent(call.filter)}`);
    case "editItem":
      return backend.call("PATCH", `/action-items/${id(call.itemId)}`, { status: call.status, owner: call.owner, due: call.due });
    default:
      throw new Error("Unknown projects call");
  }
}
