-- Private, home-scoped static furniture previews. Existing records use the UI fallback.
begin;

alter table public.furniture add column thumbnail_path text;
alter table public.furniture add constraint furniture_thumbnail_home_path_check
  check (thumbnail_path is null or thumbnail_path like home_id::text || '/' || id::text || '/%');
grant update (thumbnail_path) on public.furniture to authenticated;

insert into storage.buckets (id, name, "public", file_size_limit, allowed_mime_types)
values ('furniture-thumbnails', 'furniture-thumbnails', false, 524288, array['image/webp', 'image/png'])
on conflict (id) do update set "public" = false,
  file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy furniture_thumbnail_member_read on storage.objects for select to authenticated
  using (bucket_id = 'furniture-thumbnails' and exists (
    select 1 from public.homes h
    where h.id::text = split_part(storage.objects.name, '/', 1) and private.is_home_member(h.id)
  ));

create policy furniture_thumbnail_member_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'furniture-thumbnails' and exists (
    select 1 from public.furniture f
    where f.home_id::text = split_part(storage.objects.name, '/', 1)
      and f.id::text = split_part(storage.objects.name, '/', 2)
      and split_part(storage.objects.name, '/', 3) ~ '^[0-9a-f-]+[.](webp|png)$'
      and split_part(storage.objects.name, '/', 4) = ''
      and private.is_home_member(f.home_id)
  ));

create policy furniture_thumbnail_member_delete on storage.objects for delete to authenticated
  using (bucket_id = 'furniture-thumbnails' and exists (
    select 1 from public.homes h
    where h.id::text = split_part(storage.objects.name, '/', 1) and private.is_home_member(h.id)
  ));

commit;
