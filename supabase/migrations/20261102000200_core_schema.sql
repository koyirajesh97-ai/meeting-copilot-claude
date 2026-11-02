-- Core schema for every entity in the PRD's data model, with row-level security.
--
-- Who sees what:
--   * A private meeting (and its transcript, summary, action items...) is visible only to its owner.
--   * A meeting with visibility 'project' is visible to every member of its project.
--   * Answer/topic cards (suggestions) are always private to the meeting owner.
--   * Voiceprints are never readable through the API; only the backend (service role) reads them.
-- The backend connects with the service role and bypasses RLS; it checks ownership in code.
-- RLS protects everything clients read directly (e.g. Supabase Realtime in Phase 3).

create extension if not exists vector;
create extension if not exists pgcrypto;

-- ---------- people and projects ----------

create table public.users (
  id                       uuid primary key references auth.users (id) on delete cascade,
  email                    text,
  name                     text,
  default_role_profile_id  uuid,
  created_at               timestamptz not null default now()
);

create table public.role_profiles (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.users (id) on delete cascade,
  title             text not null default '',
  responsibilities  text not null default '',
  systems_owned     text[] not null default '{}',
  current_tickets   text[] not null default '{}',
  speaking_style    text not null default '',
  aliases           text[] not null default '{}',
  created_at        timestamptz not null default now()
);
create index role_profiles_user_idx on public.role_profiles (user_id);

alter table public.users
  add constraint users_default_role_profile_fk
  foreign key (default_role_profile_id) references public.role_profiles (id) on delete set null;

create table public.projects (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (length(name) between 1 and 200),
  description  text not null default '',
  vocabulary   text[] not null default '{}',
  created_by   uuid not null references public.users (id),
  created_at   timestamptz not null default now()
);

create table public.project_members (
  project_id  uuid not null references public.projects (id) on delete cascade,
  user_id     uuid not null references public.users (id) on delete cascade,
  role        text not null check (role in ('owner', 'member', 'viewer')),
  created_at  timestamptz not null default now(),
  primary key (project_id, user_id)
);
create index project_members_user_idx on public.project_members (user_id);

-- ---------- meetings ----------

create table public.meetings (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid references public.projects (id) on delete set null,
  owner_id    uuid not null references public.users (id) on delete cascade,
  type        text not null check (type in ('standup', 'review', 'planning', 'incident', 'client', 'one_on_one', 'research', 'custom')),
  title       text not null default 'Untitled meeting',
  started_at  timestamptz not null default now(),
  ended_at    timestamptz,
  visibility  text not null default 'private' check (visibility in ('private', 'project')),
  mode        text not null default 'cloud' check (mode in ('cloud', 'local', 'live-only')),
  vocabulary  text[] not null default '{}',
  -- Sharing needs a project to share with.
  constraint meetings_project_visibility check (visibility = 'private' or project_id is not null)
);
create index meetings_project_idx on public.meetings (project_id);
create index meetings_owner_started_idx on public.meetings (owner_id, started_at desc);

create table public.speakers (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid references public.projects (id) on delete cascade,
  user_id       uuid references public.users (id) on delete cascade,
  display_name  text not null,
  -- Encrypted by the backend before storage. Biometric data: only with consent.
  voiceprint    bytea,
  consent_at    timestamptz,
  created_at    timestamptz not null default now(),
  constraint speakers_voiceprint_needs_consent check (voiceprint is null or (consent_at is not null and user_id is not null))
);
create index speakers_project_idx on public.speakers (project_id);

create table public.transcript_segments (
  meeting_id   uuid not null references public.meetings (id) on delete cascade,
  segment_id   text not null,
  speaker_id   text not null,            -- "me" or the diarization label, e.g. "spk_1"
  speaker_ref  uuid references public.speakers (id) on delete set null,
  channel      text not null check (channel in ('mic', 'system')),
  start_ms     integer not null check (start_ms >= 0),
  end_ms       integer not null check (end_ms >= start_ms),
  text         text not null,
  is_final     boolean not null default true,
  provider     text,
  created_at   timestamptz not null default now(),
  primary key (meeting_id, segment_id)
);
create index transcript_segments_meeting_start_idx on public.transcript_segments (meeting_id, start_ms);

create table public.suggestions (
  id                  uuid primary key default gen_random_uuid(),
  meeting_id          uuid not null references public.meetings (id) on delete cascade,
  kind                text not null check (kind in ('answer', 'topic', 'clarify', 'catch_up', 'standup', 'follow_up')),
  trigger_segment_id  text,
  text                text not null,
  sources             jsonb not null default '[]',
  confidence          real,
  provider            text,
  used                boolean,
  created_at          timestamptz not null default now()
);
create index suggestions_meeting_idx on public.suggestions (meeting_id);

create table public.summaries (
  id          uuid primary key default gen_random_uuid(),
  meeting_id  uuid not null references public.meetings (id) on delete cascade,
  template    text not null,
  sections    jsonb not null default '{}',
  model       text,
  created_at  timestamptz not null default now()
);
create index summaries_meeting_idx on public.summaries (meeting_id, created_at desc);

create table public.action_items (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid references public.projects (id) on delete cascade,
  meeting_id     uuid references public.meetings (id) on delete cascade,
  owner          text,                    -- as said in the meeting
  owner_user_id  uuid references public.users (id) on delete set null,
  text           text not null,
  due_date       date,
  status         text not null default 'open' check (status in ('open', 'done', 'dropped')),
  created_by     uuid not null references public.users (id) on delete cascade,
  created_at     timestamptz not null default now()
);
create index action_items_project_idx on public.action_items (project_id);
create index action_items_meeting_idx on public.action_items (meeting_id);

create table public.decisions (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid references public.projects (id) on delete cascade,
  meeting_id  uuid references public.meetings (id) on delete cascade,
  text        text not null,
  rationale   text not null default '',
  created_by  uuid not null references public.users (id) on delete cascade,
  created_at  timestamptz not null default now()
);
create index decisions_project_idx on public.decisions (project_id);
create index decisions_meeting_idx on public.decisions (meeting_id);

create table public.standup_entries (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users (id) on delete cascade,
  project_id  uuid references public.projects (id) on delete cascade,
  date        date not null default current_date,
  done        text[] not null default '{}',
  doing       text[] not null default '{}',
  blockers    text[] not null default '{}',
  script      text not null default '',
  created_at  timestamptz not null default now(),
  unique nulls not distinct (user_id, project_id, date)
);
create index standup_entries_project_idx on public.standup_entries (project_id);

create table public.documents (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projects (id) on delete cascade,
  title         text not null,
  source_url    text,
  storage_path  text,
  uploaded_by   uuid not null references public.users (id) on delete cascade,
  created_at    timestamptz not null default now(),
  constraint documents_has_source check (source_url is not null or storage_path is not null)
);
create index documents_project_idx on public.documents (project_id);

-- One table for semantic and full-text search over transcripts, summaries and documents.
-- 384 dimensions: the default local embedding model (bge-small-en-v1.5 via fastembed).
create table public.chunks (
  id           bigint generated always as identity primary key,
  source_type  text not null check (source_type in ('transcript', 'summary', 'document')),
  source_id    text not null,
  project_id   uuid references public.projects (id) on delete cascade,
  meeting_id   uuid references public.meetings (id) on delete cascade,
  owner_id     uuid not null references public.users (id) on delete cascade,
  text         text not null,
  start_ms     integer,
  embedding    vector(384),
  tsv          tsvector generated always as (to_tsvector('english', text)) stored,
  created_at   timestamptz not null default now()
);
create index chunks_project_idx on public.chunks (project_id);
create index chunks_meeting_idx on public.chunks (meeting_id);
create index chunks_tsv_idx on public.chunks using gin (tsv);
create index chunks_embedding_idx on public.chunks using hnsw (embedding vector_cosine_ops);

create table public.consent_events (
  id          uuid primary key default gen_random_uuid(),
  meeting_id  uuid not null references public.meetings (id) on delete cascade,
  kind        text not null check (kind in ('announced', 'objection', 'paused', 'resumed')),
  note        text,
  at          timestamptz not null default now()
);
create index consent_events_meeting_idx on public.consent_events (meeting_id);

-- ---------- access helpers (security definer: they read membership without recursing RLS) ----------

create or replace function public.project_role(pid uuid) returns text
language sql stable security definer set search_path = public as $$
  select role from public.project_members where project_id = pid and user_id = auth.uid()
$$;

create or replace function public.is_project_member(pid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select pid is not null and public.project_role(pid) is not null
$$;

create or replace function public.can_read_meeting(mid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.meetings m
    where m.id = mid
      and (m.owner_id = auth.uid() or (m.visibility = 'project' and public.is_project_member(m.project_id)))
  )
$$;

create or replace function public.owns_meeting(mid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.meetings m where m.id = mid and m.owner_id = auth.uid())
$$;

-- The creator of a project becomes its owner.
create or replace function public.add_project_owner() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.project_members (project_id, user_id, role) values (new.id, new.created_by, 'owner');
  return new;
end $$;

create trigger projects_add_owner after insert on public.projects
  for each row execute function public.add_project_owner();

-- ---------- privileges ----------

revoke all on all tables in schema public from anon;
grant select, insert, update, delete on
  public.users, public.role_profiles, public.projects, public.project_members, public.meetings,
  public.transcript_segments, public.suggestions, public.summaries, public.action_items,
  public.decisions, public.standup_entries, public.documents, public.chunks, public.consent_events
  to authenticated;
-- Voiceprints: every column except the voiceprint itself.
grant select (id, project_id, user_id, display_name, consent_at, created_at) on public.speakers to authenticated;
grant insert (project_id, user_id, display_name, consent_at), delete on public.speakers to authenticated;
grant usage on all sequences in schema public to authenticated;

-- ---------- row-level security ----------

alter table public.users enable row level security;
alter table public.role_profiles enable row level security;
alter table public.projects enable row level security;
alter table public.project_members enable row level security;
alter table public.meetings enable row level security;
alter table public.speakers enable row level security;
alter table public.transcript_segments enable row level security;
alter table public.suggestions enable row level security;
alter table public.summaries enable row level security;
alter table public.action_items enable row level security;
alter table public.decisions enable row level security;
alter table public.standup_entries enable row level security;
alter table public.documents enable row level security;
alter table public.chunks enable row level security;
alter table public.consent_events enable row level security;

-- users: yourself, and people you share a project with (to show names).
create policy users_select on public.users for select to authenticated using (
  id = auth.uid() or exists (
    select 1 from public.project_members mine
    join public.project_members theirs on theirs.project_id = mine.project_id
    where mine.user_id = auth.uid() and theirs.user_id = users.id
  )
);
create policy users_update on public.users for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- role profiles: your own only.
create policy role_profiles_own on public.role_profiles for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- projects
create policy projects_select on public.projects for select to authenticated using (public.is_project_member(id));
create policy projects_insert on public.projects for insert to authenticated with check (created_by = auth.uid());
create policy projects_update on public.projects for update to authenticated
  using (public.project_role(id) = 'owner') with check (public.project_role(id) = 'owner');
create policy projects_delete on public.projects for delete to authenticated using (public.project_role(id) = 'owner');

-- project members: members see the roster; owners manage it.
create policy members_select on public.project_members for select to authenticated
  using (public.is_project_member(project_id));
create policy members_manage on public.project_members for all to authenticated
  using (public.project_role(project_id) = 'owner') with check (public.project_role(project_id) = 'owner');

-- meetings
create policy meetings_select on public.meetings for select to authenticated using (
  owner_id = auth.uid() or (visibility = 'project' and public.is_project_member(project_id))
);
create policy meetings_insert on public.meetings for insert to authenticated with check (
  owner_id = auth.uid() and (project_id is null or public.project_role(project_id) in ('owner', 'member'))
);
create policy meetings_update on public.meetings for update to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid() and (project_id is null or public.project_role(project_id) in ('owner', 'member')));
create policy meetings_delete on public.meetings for delete to authenticated using (owner_id = auth.uid());

-- speakers: project members see names; people manage only their own (self-enrollment).
create policy speakers_select on public.speakers for select to authenticated
  using (user_id = auth.uid() or public.is_project_member(project_id));
create policy speakers_insert on public.speakers for insert to authenticated
  with check (user_id = auth.uid() and (project_id is null or public.is_project_member(project_id)));
create policy speakers_delete on public.speakers for delete to authenticated using (user_id = auth.uid());

-- Meeting content: readable with the meeting, writable by the meeting owner.
create policy segments_select on public.transcript_segments for select to authenticated using (public.can_read_meeting(meeting_id));
create policy segments_write on public.transcript_segments for all to authenticated
  using (public.owns_meeting(meeting_id)) with check (public.owns_meeting(meeting_id));

create policy summaries_select on public.summaries for select to authenticated using (public.can_read_meeting(meeting_id));
create policy summaries_write on public.summaries for all to authenticated
  using (public.owns_meeting(meeting_id)) with check (public.owns_meeting(meeting_id));

create policy consent_select on public.consent_events for select to authenticated using (public.can_read_meeting(meeting_id));
create policy consent_write on public.consent_events for insert to authenticated with check (public.owns_meeting(meeting_id));

-- Cards are private to the meeting owner, even in shared meetings.
create policy suggestions_own on public.suggestions for all to authenticated
  using (public.owns_meeting(meeting_id)) with check (public.owns_meeting(meeting_id));

-- Action items and decisions follow their meeting; ones without a meeting follow their project.
create policy action_items_select on public.action_items for select to authenticated using (
  case when meeting_id is not null then public.can_read_meeting(meeting_id)
       when project_id is not null then public.is_project_member(project_id)
       else created_by = auth.uid() end
);
create policy action_items_insert on public.action_items for insert to authenticated with check (
  created_by = auth.uid() and case
    when meeting_id is not null then public.owns_meeting(meeting_id)
    when project_id is not null then public.project_role(project_id) in ('owner', 'member')
    else true end
);
create policy action_items_update on public.action_items for update to authenticated using (
  created_by = auth.uid() or owner_user_id = auth.uid()
  or (meeting_id is null and public.project_role(project_id) in ('owner', 'member'))
  or (meeting_id is not null and public.can_read_meeting(meeting_id) and public.project_role(project_id) in ('owner', 'member'))
);
create policy action_items_delete on public.action_items for delete to authenticated using (created_by = auth.uid());

create policy decisions_select on public.decisions for select to authenticated using (
  case when meeting_id is not null then public.can_read_meeting(meeting_id)
       when project_id is not null then public.is_project_member(project_id)
       else created_by = auth.uid() end
);
create policy decisions_write on public.decisions for all to authenticated
  using (created_by = auth.uid()) with check (
    created_by = auth.uid() and (meeting_id is null or public.owns_meeting(meeting_id))
  );

-- Standup entries: your own.
create policy standup_own on public.standup_entries for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Documents: project knowledge for members; members (not viewers) add; uploader or owner removes.
create policy documents_select on public.documents for select to authenticated using (public.is_project_member(project_id));
create policy documents_insert on public.documents for insert to authenticated with check (
  uploaded_by = auth.uid() and public.project_role(project_id) in ('owner', 'member')
);
create policy documents_delete on public.documents for delete to authenticated using (
  uploaded_by = auth.uid() or public.project_role(project_id) = 'owner'
);

-- Search chunks: readable with their meeting, project or owner; written only by the backend.
create policy chunks_select on public.chunks for select to authenticated using (
  case when meeting_id is not null then public.can_read_meeting(meeting_id)
       when project_id is not null then public.is_project_member(project_id)
       else owner_id = auth.uid() end
);
