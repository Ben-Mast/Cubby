-- Shared two-dimensional floor and wall designs. Apply after configurable dimensions.
begin;

create table public.surfaces (
  id uuid primary key default gen_random_uuid(),
  home_id uuid not null references public.homes(id) on delete cascade,
  creator_id uuid not null references public.profiles(id),
  name text not null check (length(btrim(name)) > 0),
  type text not null check (type in ('floor', 'wall')),
  pixel_data jsonb not null,
  width integer not null check (width between 2 and 24),
  height integer not null check (height between 2 and 24),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, home_id)
);
create index surfaces_home_created_idx on public.surfaces(home_id, created_at desc);
create index surfaces_creator_idx on public.surfaces(creator_id);

create trigger surfaces_updated_at before update on public.surfaces
  for each row execute function private.set_updated_at();

create function private.validate_surface_pixels()
returns trigger language plpgsql security invoker set search_path = ''
as $$
begin
  if new.pixel_data->>'version' is distinct from '1'
    or jsonb_typeof(new.pixel_data->'pixels') is distinct from 'array'
    or jsonb_array_length(new.pixel_data->'pixels') <> new.width * new.height
    or exists (select 1 from jsonb_array_elements(new.pixel_data->'pixels') pixel
      where jsonb_typeof(pixel) is distinct from 'string'
        or pixel #>> '{}' !~ '^#[0-9a-fA-F]{6}$') then
    raise exception 'Surface needs one valid color per cell.' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function private.validate_surface_pixels() from public, anon, authenticated;
create trigger surfaces_validate_pixels before insert or update of pixel_data, width, height on public.surfaces
  for each row execute function private.validate_surface_pixels();

alter table public.homes
  add column floor_surface_id uuid references public.surfaces(id) on delete set null,
  add column wall_surface_id uuid references public.surfaces(id) on delete set null;

create function private.validate_home_surfaces()
returns trigger language plpgsql security invoker set search_path = ''
as $$
begin
  if new.floor_surface_id is not null and not exists (
    select 1 from public.surfaces where id = new.floor_surface_id and home_id = new.id and type = 'floor'
  ) then raise exception 'Choose a floor surface from this home.' using errcode = '23514'; end if;
  if new.wall_surface_id is not null and not exists (
    select 1 from public.surfaces where id = new.wall_surface_id and home_id = new.id and type = 'wall'
  ) then raise exception 'Choose a wall surface from this home.' using errcode = '23514'; end if;
  return new;
end;
$$;
revoke all on function private.validate_home_surfaces() from public, anon, authenticated;
create trigger homes_validate_surfaces before update of floor_surface_id, wall_surface_id on public.homes
  for each row execute function private.validate_home_surfaces();

alter table public.surfaces enable row level security;
create policy surfaces_member_read on public.surfaces for select to authenticated
  using (private.is_home_member(home_id));
create policy surfaces_member_insert on public.surfaces for insert to authenticated
  with check (private.is_home_member(home_id) and creator_id = (select auth.uid()));
create policy surfaces_member_update on public.surfaces for update to authenticated
  using (private.is_home_member(home_id)) with check (private.is_home_member(home_id));
create policy surfaces_member_delete on public.surfaces for delete to authenticated
  using (private.is_home_member(home_id));

revoke all on public.surfaces from public, anon, authenticated;
grant select, delete on public.surfaces to authenticated;
grant insert (home_id, creator_id, name, type, pixel_data, width, height) on public.surfaces to authenticated;
grant update (name, pixel_data, width, height) on public.surfaces to authenticated;
grant update (floor_surface_id, wall_surface_id) on public.homes to authenticated;

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
    and schemaname = 'public' and tablename = 'surfaces') then
    alter publication supabase_realtime add table public.surfaces;
  end if;
end $$;

commit;
