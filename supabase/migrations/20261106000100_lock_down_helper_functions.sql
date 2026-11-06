-- Security advisor: SECURITY DEFINER functions in the API schema were callable by anyone through
-- /rest/v1/rpc. Trigger functions need no EXECUTE grant to fire, so nobody gets one. The four
-- access helpers are used inside RLS policies, which run as the signed-in user, so only
-- `authenticated` keeps EXECUTE (they only ever answer about auth.uid()'s own access).

revoke execute on function public.add_project_owner() from public, anon, authenticated;
revoke execute on function public.delete_voiceprint_on_leave() from public, anon, authenticated;
revoke execute on function public.project_role(uuid) from public, anon;
revoke execute on function public.is_project_member(uuid) from public, anon;
revoke execute on function public.can_read_meeting(uuid) from public, anon;
revoke execute on function public.owns_meeting(uuid) from public, anon;
grant execute on function public.project_role(uuid) to authenticated;
grant execute on function public.is_project_member(uuid) to authenticated;
grant execute on function public.can_read_meeting(uuid) to authenticated;
grant execute on function public.owns_meeting(uuid) to authenticated;
