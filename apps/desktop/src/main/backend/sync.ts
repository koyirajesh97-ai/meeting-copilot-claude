// Sync worker: pull meetings and transcripts from the backend into the local cache, filling in
// anything missed while offline. The backend is the source of truth for transcripts.

import type { Cache } from "./cache";
import type { BackendClient } from "./client";

export async function syncMeeting(backend: BackendClient, cache: Cache, id: string): Promise<number> {
  const m = await backend.getMeeting(id);
  cache.upsertMeeting(m);
  for (const s of m.transcript) cache.upsertSegment(id, s);
  cache.upsertExtras(id, {
    summary: m.summary,
    action_items: m.action_items,
    decisions: m.decisions,
    speaker_names: m.speaker_names,
  });
  cache.markSynced(id, Date.now() / 1000);
  return m.transcript.length;
}

/**
 * Pull everything new, and drop meetings the server no longer has (deleted elsewhere, by the
 * retention setting, or unshared). Returns the deleted meetings' recording folders.
 */
export async function syncAll(backend: BackendClient, cache: Cache, removed: (dir: string) => void = () => undefined): Promise<number> {
  const server = await backend.listMeetings();
  const onServer = new Set(server.map((m) => m.id));
  // Only meetings synced before: one recorded offline and not uploaded yet stays.
  for (const id of cache.syncedMeetingIds()) {
    if (onServer.has(id)) continue;
    const dir = cache.deleteMeeting(id);
    if (dir) removed(dir);
  }
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

/** After a meeting ends, wait for its summary (pending -> ready/failed), then sync it. */
export async function waitForSummary(
  backend: BackendClient,
  cache: Cache,
  id: string,
  { intervalMs = 3000, timeoutMs = 180_000 } = {},
): Promise<string> {
  const end = Date.now() + timeoutMs;
  let status = "pending";
  while (Date.now() < end) {
    status = (await backend.getSummary(id)).status;
    if (status !== "pending") break;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  await syncMeeting(backend, cache, id);
  return status;
}
