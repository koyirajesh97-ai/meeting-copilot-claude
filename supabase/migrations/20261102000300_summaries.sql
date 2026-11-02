-- Summaries (Prompt 7): job status on meetings, where action items/decisions came from,
-- and speaker names given in a meeting ("Speaker 2" -> "Priya"; text only, never a voiceprint).

alter table public.meetings
  add column summary_status text not null default 'none'
    check (summary_status in ('none', 'pending', 'ready', 'failed')),
  add column summary_error text;

-- 'summary' rows are replaced when the summary is regenerated; others are kept.
alter table public.action_items
  add column source text not null default 'manual' check (source in ('summary', 'manual', 'follow_up')),
  add column due_text text;   -- as said ("Friday"); due_date is set when it's an exact date
alter table public.decisions
  add column source text not null default 'manual' check (source in ('summary', 'manual'));

create table public.meeting_speakers (
  meeting_id    uuid not null references public.meetings (id) on delete cascade,
  label         text not null,          -- e.g. "spk_1"
  display_name  text not null check (length(display_name) between 1 and 100),
  primary key (meeting_id, label)
);

grant select, insert, update, delete on public.meeting_speakers to authenticated;
alter table public.meeting_speakers enable row level security;
create policy meeting_speakers_select on public.meeting_speakers for select to authenticated
  using (public.can_read_meeting(meeting_id));
create policy meeting_speakers_write on public.meeting_speakers for all to authenticated
  using (public.owns_meeting(meeting_id)) with check (public.owns_meeting(meeting_id));
