-- Projects and team sync (Prompt 13): pending invites for people who don't have an account yet.

create table public.project_invites (
  project_id  uuid not null references public.projects (id) on delete cascade,
  email       text not null check (email = lower(email)),
  role        text not null check (role in ('owner', 'member', 'viewer')),
  invited_by  uuid not null references public.users (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (project_id, email)
);
create index project_invites_email_idx on public.project_invites (email);

grant select, insert, delete on public.project_invites to authenticated;
alter table public.project_invites enable row level security;
-- Project owners manage invites; people see invites addressed to their own email.
create policy invites_owner on public.project_invites for all to authenticated
  using (public.project_role(project_id) = 'owner') with check (public.project_role(project_id) = 'owner');
create policy invites_mine on public.project_invites for select to authenticated
  using (email = lower(coalesce(auth.jwt() ->> 'email', '')));

create index users_email_idx on public.users (lower(email));
