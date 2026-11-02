-- Privacy settings per user (Prompt 14). Consent events already live in public.consent_events.

alter table public.users
  add column allow_test_providers boolean not null default false,
  add column retention_days integer check (retention_days is null or retention_days between 1 and 3650),
  add column consent_message text check (consent_message is null or length(consent_message) <= 1000);

comment on column public.users.allow_test_providers is
  'Settings opt-in (off by default): let meeting data reach providers marked trains_on_data true or unknown.';
comment on column public.users.retention_days is
  'Delete meetings older than this many days (null keeps them until you delete them).';
