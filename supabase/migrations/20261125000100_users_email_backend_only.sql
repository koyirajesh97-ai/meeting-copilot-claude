-- public.users.email is what project invites match on, so only the backend may write it (it copies
-- the verified address from Supabase Auth at sign-in). Before this, a signed-in user could PATCH
-- their own row through the Data API, set someone else's address, and be added to projects in
-- their place. People keep editing their other settings directly.
revoke insert, update on public.users from authenticated;
grant update (name, default_role_profile_id, allow_test_providers, retention_days, consent_message)
  on public.users to authenticated;
