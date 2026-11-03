-- Integrations (Prompt 16): calendars, Jira and chat webhooks, per user. Secrets (OAuth refresh
-- tokens, the Jira API token, webhook URLs) are encrypted by the backend before they're stored.

create table public.user_integrations (
  user_id     uuid not null references public.users (id) on delete cascade,
  kind        text not null check (kind in ('google', 'microsoft', 'jira', 'slack', 'teams')),
  enabled     boolean not null default true,
  config      jsonb not null default '{}'::jsonb,  -- non-secret settings (Jira site and email)
  secret      bytea,                               -- Fernet-sealed JSON
  last_error  text,
  updated_at  timestamptz not null default now(),
  primary key (user_id, kind)
);

alter table public.user_integrations enable row level security;
-- Only the backend (service role) reads secrets; users may see and remove their own rows.
create policy integrations_select on public.user_integrations for select to authenticated using (user_id = auth.uid());
create policy integrations_delete on public.user_integrations for delete to authenticated using (user_id = auth.uid());

alter table public.meetings add column calendar_event_id text;
create index meetings_calendar_event_idx on public.meetings (owner_id, calendar_event_id) where calendar_event_id is not null;
