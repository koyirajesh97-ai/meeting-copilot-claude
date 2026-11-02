-- Standup prep and the pre-meeting brief (Prompt 12).
alter table public.standup_entries add column notes text not null default '';
alter table public.meetings add column agenda text not null default '';
