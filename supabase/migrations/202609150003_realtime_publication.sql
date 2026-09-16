-- Phase 8: publish only the two shared tables needed by the MVP.
begin;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'furniture'
  ) then alter publication supabase_realtime add table public.furniture; end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'placed_furniture'
  ) then alter publication supabase_realtime add table public.placed_furniture; end if;
end;
$$;

commit;
