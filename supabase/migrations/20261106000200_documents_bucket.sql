-- Project documents uploaded through the backend (service role). Private: no public URLs and no
-- client policies, so only the backend can read or write it. Skipped where there's no Supabase
-- Storage (plain Postgres in tests).
do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit)
    values ('documents', 'documents', false, 20971520)
    on conflict (id) do nothing;
  end if;
end $$;
