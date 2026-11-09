-- Account deletion ("Delete my account") removes the Supabase Auth user, which cascades to every
-- row the person owns. auth.users belongs to Supabase, so a dedicated backend login can't be
-- granted DELETE on it; this function does that one thing, for one id, and only the backend may
-- call it (EXECUTE is granted to the backend's own role at deploy time, never to API roles).
create or replace function public.delete_auth_user(uid uuid) returns void
language sql security definer set search_path = '' as $$
  delete from auth.users where id = uid;
$$;

revoke execute on function public.delete_auth_user(uuid) from public, anon, authenticated;
