-- Persist voxel-unit room and furniture workspace dimensions. Existing data
-- keeps the former 64 x 64 x 16 room and 16 x 16 x 16 editor defaults.
begin;

alter table public.homes
  add column width integer not null default 64 check (width between 1 and 128),
  add column depth integer not null default 64 check (depth between 1 and 128),
  add column height integer not null default 16 check (height between 1 and 64);

alter table public.furniture
  add column size_x integer not null default 16 check (size_x between 1 and 24),
  add column size_y integer not null default 16 check (size_y between 1 and 24),
  add column size_z integer not null default 16 check (size_z between 1 and 24);

alter table public.furniture add constraint furniture_size_matches_voxel_data
  check ((voxel_data->'size' = jsonb_build_array(size_x, size_y, size_z)) is true);

create policy homes_member_resize on public.homes for update to authenticated
  using (private.is_home_member(id)) with check (private.is_home_member(id));
grant update (width, depth, height) on public.homes to authenticated;
grant insert (size_x, size_y, size_z), update (size_x, size_y, size_z) on public.furniture to authenticated;

create or replace function private.room_world_voxels(model jsonb, px integer, py integer, pz integer, turns integer)
returns table(wx integer, wy integer, wz integer)
language plpgsql stable security invoker set search_path = ''
as $$
declare cells jsonb; sx integer; sy integer; sz integer;
begin
  if model->>'version' is distinct from '1' or jsonb_typeof(model->'size') is distinct from 'array'
    or jsonb_array_length(model->'size') <> 3 or jsonb_typeof(model->'voxels') is distinct from 'array' then
    raise exception 'Furniture has invalid voxel data.' using errcode = '23514';
  end if;
  sx := (model->'size'->>0)::integer;
  sy := (model->'size'->>1)::integer;
  sz := (model->'size'->>2)::integer;
  if sx not between 1 and 24 or sy not between 1 and 24 or sz not between 1 and 24 then
    raise exception 'Furniture has invalid voxel dimensions.' using errcode = '23514';
  end if;
  cells := model->'voxels';
  if jsonb_array_length(cells) = 0 or jsonb_array_length(cells) > sx * sy * sz then
    raise exception 'Furniture must contain voxels.' using errcode = '23514';
  end if;
  if turns not in (0, 90, 180, 270) then
    raise exception 'Use 90 degree rotations.' using errcode = '23514';
  end if;
  if exists (
    select 1 from jsonb_array_elements(cells) v
    where (v->>'x')::numeric <> trunc((v->>'x')::numeric)
      or (v->>'y')::numeric <> trunc((v->>'y')::numeric)
      or (v->>'z')::numeric <> trunc((v->>'z')::numeric)
      or (v->>'x')::numeric not between 0 and sx - 1
      or (v->>'y')::numeric not between 0 and sy - 1
      or (v->>'z')::numeric not between 0 and sz - 1
  ) then raise exception 'Furniture has invalid voxel coordinates.' using errcode = '23514'; end if;

  return query
    with coordinates as (
      select (v->>'x')::integer vx, (v->>'y')::integer vy, (v->>'z')::integer vz
      from jsonb_array_elements(cells) v
    ), normalized as (
      select vx - min(vx) over () as x, vy - min(vy) over () as y, vz - min(vz) over () as z,
        max(vx) over () - min(vx) over () as max_x,
        max(vz) over () - min(vz) over () as max_z
      from coordinates
    )
    select px + case turns when 0 then x when 90 then z when 180 then max_x - x else max_z - z end,
      py + y,
      pz + case turns when 0 then z when 90 then max_x - x when 180 then max_z - z else x end
    from normalized;
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception 'Furniture has invalid voxel coordinates.' using errcode = '23514';
end;
$$;

create or replace function private.validate_room_placement()
returns trigger language plpgsql security invoker set search_path = ''
as $$
declare model jsonb; room_width integer; room_depth integer; room_height integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(new.home_id::text, 0));
  select width, depth, height into room_width, room_depth, room_height
    from public.homes where id = new.home_id;
  select voxel_data into model from public.furniture
    where id = new.furniture_id and home_id = new.home_id;
  if not found then raise exception 'Furniture is unavailable in this home.' using errcode = '23503'; end if;

  if exists (
    select 1 from private.room_world_voxels(model, new.x, new.y, new.z, new.rotation) v
    where v.wx < 0 or v.wx >= room_width or v.wz < 0 or v.wz >= room_depth
      or v.wy < 0 or v.wy >= room_height
  ) then raise exception 'Furniture must fit inside the room.' using errcode = '23514'; end if;

  if exists (
    with candidate as materialized (
      select * from private.room_world_voxels(model, new.x, new.y, new.z, new.rotation)
    )
    select 1 from public.placed_furniture p
    join public.furniture f on f.id = p.furniture_id and f.home_id = p.home_id
    cross join lateral private.room_world_voxels(f.voxel_data, p.x, p.y, p.z, p.rotation) other
    join candidate c on c.wx = other.wx and c.wy = other.wy and c.wz = other.wz
    where p.home_id = new.home_id and p.id <> new.id
  ) then raise exception 'Furniture overlaps another placed item.' using errcode = '23514'; end if;

  if new.y > 0 and not exists (
    with candidate as materialized (
      select * from private.room_world_voxels(model, new.x, new.y, new.z, new.rotation)
    )
    select 1 from public.placed_furniture p
    join public.furniture f on f.id = p.furniture_id and f.home_id = p.home_id
    cross join lateral private.room_world_voxels(f.voxel_data, p.x, p.y, p.z, p.rotation) other
    join candidate c on c.wx = other.wx and c.wy = other.wy + 1 and c.wz = other.wz
    where p.home_id = new.home_id and p.id <> new.id
  ) then raise exception 'Furniture needs support from the floor or another item.' using errcode = '23514'; end if;
  return new;
end;
$$;

create function private.validate_room_resize()
returns trigger language plpgsql security invoker set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(new.id::text, 0));
  if exists (
    select 1 from public.placed_furniture p
    join public.furniture f on f.id = p.furniture_id and f.home_id = p.home_id
    cross join lateral private.room_world_voxels(f.voxel_data, p.x, p.y, p.z, p.rotation) v
    where p.home_id = new.id and (v.wx < 0 or v.wx >= new.width or v.wz < 0 or v.wz >= new.depth
      or v.wy < 0 or v.wy >= new.height)
  ) then raise exception 'Existing furniture would be outside the resized room.' using errcode = '23514'; end if;
  return new;
end;
$$;
revoke all on function private.validate_room_resize() from public, anon, authenticated;
create trigger homes_validate_resize before update of width, depth, height on public.homes
  for each row execute function private.validate_room_resize();

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
    and schemaname = 'public' and tablename = 'homes') then
    alter publication supabase_realtime add table public.homes;
  end if;
end $$;

commit;
