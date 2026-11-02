// Local SQLite cache (Node's built-in node:sqlite: no native module to rebuild for Electron).
// Live finals are written here as they arrive, and the sync worker fills in anything missed,
// so Meetings home and Meeting detail work offline and survive restarts.

import { DatabaseSync } from "node:sqlite";
import type { CachedMeeting, CachedMeetingDetail, CachedSegment, SummaryInfo } from "../../shared/ipc";

const SCHEMA = `
create table if not exists meetings (
  id          text primary key,
  title       text not null,
  type        text not null,
  mode        text not null,
  started_at  real not null,
  ended_at    real,
  synced_at   real
);
create table if not exists segments (
  meeting_id  text not null references meetings (id) on delete cascade,
  segment_id  text not null,
  channel     text not null,
  speaker_id  text not null,
  text        text not null,
  start_ms    integer not null,
  end_ms      integer not null,
  primary key (meeting_id, segment_id)
);
create index if not exists segments_by_time on segments (meeting_id, start_ms);
-- added in Phase 3; see migrate()
create table if not exists details (
  meeting_id  text primary key references meetings (id) on delete cascade,
  json        text not null   -- summary, action items, decisions, speaker names (as the backend sent them)
);
`;

export type MeetingExtras = Pick<CachedMeetingDetail, "summary" | "action_items" | "decisions" | "speaker_names">;

export const NO_SUMMARY: SummaryInfo = { status: "none", error: null, id: null, template: null, data: null };
const EMPTY_EXTRAS: MeetingExtras = { summary: NO_SUMMARY, action_items: [], decisions: [], speaker_names: {} };

export interface MeetingRow {
  id: string;
  title: string;
  type: string;
  mode: string;
  started_at: number;
  ended_at: number | null;
  is_mine?: boolean;
  is_live?: boolean;
  visibility?: string;
  project_id?: string | null;
}

export class Cache {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec("pragma journal_mode = wal; pragma foreign_keys = on;");
    this.db.exec(SCHEMA);
    this.migrate();
  }

  /** Columns added after the first release (SQLite has no "add column if not exists"). */
  private migrate(): void {
    const cols = new Set((this.db.prepare("pragma table_info(meetings)").all() as { name: string }[]).map((c) => c.name));
    const add: [string, string][] = [
      ["is_mine", "integer not null default 1"],
      ["is_live", "integer not null default 0"],
      ["visibility", "text not null default 'private'"],
      ["project_id", "text"],
      ["recording_dir", "text"],
    ];
    for (const [name, def] of add) if (!cols.has(name)) this.db.exec(`alter table meetings add column ${name} ${def}`);
  }

  close(): void {
    this.db.close();
  }

  upsertMeeting(m: MeetingRow): void {
    this.db
      .prepare(
        `insert into meetings (id, title, type, mode, started_at, ended_at, is_mine, is_live, visibility, project_id)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         on conflict (id) do update set title = excluded.title, type = excluded.type, mode = excluded.mode,
           ended_at = coalesce(excluded.ended_at, meetings.ended_at), is_mine = excluded.is_mine,
           is_live = excluded.is_live, visibility = excluded.visibility, project_id = excluded.project_id`,
      )
      .run(m.id, m.title, m.type, m.mode, m.started_at, m.ended_at, m.is_mine === false ? 0 : 1, m.is_live ? 1 : 0,
        m.visibility ?? "private", m.project_id ?? null);
  }

  /** Remember where this meeting's WAV files are, so deleting the meeting deletes them. */
  setRecordingDir(id: string, dir: string | null): void {
    this.db.prepare("update meetings set recording_dir = ? where id = ?").run(dir, id);
  }

  /** Delete a meeting and its transcript and details. Returns its recording folder, if any. */
  deleteMeeting(id: string): string | null {
    const row = this.db.prepare("select recording_dir from meetings where id = ?").get(id) as { recording_dir: string | null } | undefined;
    this.db.prepare("delete from segments where meeting_id = ?").run(id);
    this.db.prepare("delete from details where meeting_id = ?").run(id);
    this.db.prepare("delete from meetings where id = ?").run(id);
    return row?.recording_dir ?? null;
  }

  /** Meetings this computer synced before (so the server had them). */
  syncedMeetingIds(): string[] {
    return (this.db.prepare("select id from meetings where synced_at is not null").all() as { id: string }[]).map((r) => r.id);
  }

  /** Delete everything (after deleting the account). */
  clearAll(): void {
    this.db.exec("delete from segments; delete from details; delete from meetings;");
  }

  markEnded(id: string, at: number): void {
    this.db.prepare("update meetings set ended_at = coalesce(ended_at, ?) where id = ?").run(at, id);
  }

  markSynced(id: string, at: number): void {
    this.db.prepare("update meetings set synced_at = ? where id = ?").run(at, id);
  }

  upsertSegment(meetingId: string, s: CachedSegment): void {
    this.db
      .prepare(
        `insert into segments (meeting_id, segment_id, channel, speaker_id, text, start_ms, end_ms)
         values (?, ?, ?, ?, ?, ?, ?)
         on conflict (meeting_id, segment_id) do update set text = excluded.text, end_ms = excluded.end_ms,
           speaker_id = excluded.speaker_id`,
      )
      .run(meetingId, s.segment_id, s.channel, s.speaker_id, s.text, s.start_ms, s.end_ms);
  }

  upsertExtras(meetingId: string, extras: Partial<MeetingExtras>): void {
    const merged = { ...this.extras(meetingId), ...extras };
    this.db
      .prepare("insert into details (meeting_id, json) values (?, ?) on conflict (meeting_id) do update set json = excluded.json")
      .run(meetingId, JSON.stringify(merged));
  }

  extras(meetingId: string): MeetingExtras {
    const row = this.db.prepare("select json from details where meeting_id = ?").get(meetingId) as { json: string } | undefined;
    if (!row) return { ...EMPTY_EXTRAS };
    try {
      return { ...EMPTY_EXTRAS, ...(JSON.parse(row.json) as Partial<MeetingExtras>) };
    } catch {
      return { ...EMPTY_EXTRAS };
    }
  }

  listMeetings(limit = 200): CachedMeeting[] {
    return this.db
      .prepare(
        `select m.id, m.title, m.type, m.mode, m.started_at, m.ended_at, m.is_mine, m.is_live, m.visibility, m.project_id,
                (select count(*) from segments s where s.meeting_id = m.id) as segment_count
         from meetings m order by m.started_at desc limit ?`,
      )
      .all(limit)
      .map(toMeeting);
  }

  getMeeting(id: string): CachedMeetingDetail | null {
    const m = this.db
      .prepare(
        `select id, title, type, mode, started_at, ended_at, is_mine, is_live, visibility, project_id,
                (select count(*) from segments s where s.meeting_id = meetings.id) as segment_count
         from meetings where id = ?`,
      )
      .get(id);
    if (!m) return null;
    const transcript = this.db
      .prepare(
        `select segment_id, channel, speaker_id, text, start_ms, end_ms from segments
         where meeting_id = ? order by start_ms, segment_id`,
      )
      .all(id) as unknown as CachedSegment[];
    return { ...toMeeting(m), transcript, ...this.extras(id) };
  }

  /** Meetings that may be missing segments: not synced since they ended. */
  unsyncedMeetingIds(): string[] {
    const rows = this.db
      .prepare("select id from meetings where synced_at is null or (ended_at is not null and synced_at < ended_at)")
      .all() as { id: string }[];
    return rows.map((r) => r.id);
  }
}

function toMeeting(r: unknown): CachedMeeting {
  const row = r as Record<string, unknown>;
  return {
    id: String(row.id), title: String(row.title), type: String(row.type), mode: String(row.mode),
    started_at: Number(row.started_at), ended_at: row.ended_at === null ? null : Number(row.ended_at),
    segment_count: Number(row.segment_count ?? 0), is_mine: Number(row.is_mine ?? 1) === 1, is_live: Number(row.is_live ?? 0) === 1,
    visibility: String(row.visibility ?? "private"), project_id: (row.project_id as string | null) ?? null,
  };
}
