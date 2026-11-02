// Sync worker: pull meetings and transcripts from the backend into the local cache, filling in
// anything missed while offline. The backend is the source of truth for transcripts.

import type { Cache } from "./cache";
import type { BackendClient } from "./client";

export async function syncMeeting(backend: BackendClient, cache: Cache, id: string): Promise<number> {
  const m = await backend.getMeeting(id);
  cache.upsertMeeting(m);
  for (const s of m.transcript) cache.upsertSegment(id, s);
  cache.markSynced(id, Date.now() / 1000);
  return m.transcript.length;
}

export async function syncAll(backend: BackendClient, cache: Cache): Promise<number> {
  const server = await backend.listMeetings();
  const local = new Map(cache.listMeetings(1000).map((m) => [m.id, m]));
  const stale = new Set(cache.unsyncedMeetingIds());
  for (const m of server) {
    const known = local.get(m.id);
    cache.upsertMeeting(m);
    // New to this machine, ended since the last sync, or never synced.
    if (!known || stale.has(m.id) || (m.ended_at !== null && known.ended_at === null)) {
      await syncMeeting(backend, cache, m.id);
    }
  }
  return server.length;
}
