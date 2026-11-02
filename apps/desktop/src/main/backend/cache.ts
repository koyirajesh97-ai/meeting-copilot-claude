// Local SQLite cache (Node's built-in node:sqlite: no native module to rebuild for Electron).
// Live finals are written here as they arrive, and the sync worker fills in anything missed,
// so Meetings home and Meeting detail work offline and survive restarts.

import { DatabaseSync } from "node:sqlite";
import type { CachedMeeting, CachedMeetingDetail, CachedSegment } from "../../shared/ipc";

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
`;

export interface MeetingRow {
  id: string;
  title: string;
  type: string;
  mode: string;
  started_at: number;
  ended_at: number | null;
}

export class Cache {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec("pragma journal_mode = wal; pragma foreign_keys = on;");
    this.db.exec(SCHEMA);
  }

  close(): void {
    this.db.close();
  }

  upsertMeeting(m: MeetingRow): void {
    this.db
      .prepare(
        `insert into meetings (id, title, type, mode, started_at, ended_at) values (?, ?, ?, ?, ?, ?)
         on conflict (id) do update set title = excluded.title, type = excluded.type, mode = excluded.mode,
           ended_at = coalesce(excluded.ended_at, meetings.ended_at)`,
      )
      .run(m.id, m.title, m.type, m.mode, m.started_at, m.ended_at);
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

  listMeetings(limit = 200): CachedMeeting[] {
    return this.db
      .prepare(
        `select m.id, m.title, m.type, m.mode, m.started_at, m.ended_at,
                (select count(*) from segments s where s.meeting_id = m.id) as segment_count
         from meetings m order by m.started_at desc limit ?`,
      )
      .all(limit) as unknown as CachedMeeting[];
  }

  getMeeting(id: string): CachedMeetingDetail | null {
    const m = this.db
      .prepare(
        `select id, title, type, mode, started_at, ended_at,
                (select count(*) from segments s where s.meeting_id = meetings.id) as segment_count
         from meetings where id = ?`,
      )
      .get(id) as unknown as CachedMeeting | undefined;
    if (!m) return null;
    const transcript = this.db
      .prepare(
        `select segment_id, channel, speaker_id, text, start_ms, end_ms from segments
         where meeting_id = ? order by start_ms, segment_id`,
      )
      .all(id) as unknown as CachedSegment[];
    return { ...m, transcript };
  }

  /** Meetings that may be missing segments: not synced since they ended. */
  unsyncedMeetingIds(): string[] {
    const rows = this.db
      .prepare("select id from meetings where synced_at is null or (ended_at is not null and synced_at < ended_at)")
      .all() as { id: string }[];
    return rows.map((r) => r.id);
  }
}
