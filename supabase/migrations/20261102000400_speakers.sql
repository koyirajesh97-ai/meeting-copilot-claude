-- Voice enrollment (Prompt 9): one voiceprint per person per project (or personal), and
-- leaving a project deletes your voiceprint there.

create unique index speakers_one_per_person on public.speakers (user_id, project_id) nulls not distinct
  where user_id is not null;

create or replace function public.delete_voiceprint_on_leave() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from public.speakers where project_id = old.project_id and user_id = old.user_id;
  return old;
end $$;

create trigger project_members_delete_voiceprint after delete on public.project_members
  for each row execute function public.delete_voiceprint_on_leave();
