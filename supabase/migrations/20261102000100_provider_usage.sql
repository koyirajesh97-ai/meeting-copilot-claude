-- Daily usage per provider, model and task. Feeds the router's quota tracker and GET /usage.
-- Written only by the backend (service role); not project data, so no user-facing policies.

create table if not exists public.provider_usage (
  provider       text        not null,
  model          text        not null,
  task           text        not null,
  day            date        not null,
  requests       integer     not null default 0 check (requests >= 0),
  tokens         bigint      not null default 0 check (tokens >= 0),
  audio_seconds  double precision not null default 0 check (audio_seconds >= 0),
  updated_at     timestamptz not null default now(),
  primary key (provider, model, task, day)
);

create index if not exists provider_usage_day_idx on public.provider_usage (day);

alter table public.provider_usage enable row level security;
-- No policies: anon and authenticated users can't read or write it; the service role bypasses RLS.
