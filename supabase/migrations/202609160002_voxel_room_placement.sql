-- Voxel-grid placement: preserve existing world positions while moving from
-- quarter-unit voxels to integer x/y/z voxel coordinates (64 x 16 x 64).
begin;

drop trigger placed_furniture_validate on public.placed_furniture;
drop function private.validate_room_placement();
drop function private.voxel_footprint(jsonb);

alter table public.placed_furniture add column y integer not null default 0;
update public.placed_furniture set x = x * 4, z = z * 4;
alter table public.placed_furniture add constraint placed_furniture_y_nonnegative check (y >= 0);
grant insert (y), update (y) on public.placed_furniture to authenticated;

create function private.room_world_voxels(model jsonb, px integer, py integer, pz integer, turns integer)
returns table(wx integer, wy integer, wz integer)
language plpgsql stable security invoker set search_path = ''
as $$
declare cells jsonb;
begin
  if model->>'version' is distinct from '1' or model->'size' is distinct from '[16,16,16]'::jsonb
    or jsonb_typeof(model->'voxels') is distinct from 'array' then
    raise exception 'Furniture has invalid voxel data.' using errcode = '23514';
  end if;
  cells := model->'voxels';
  if jsonb_array_length(cells) = 0 or jsonb_array_length(cells) > 4096 then
    raise exception 'Furniture must contain voxels.' using errcode = '23514';
  end if;
  if turns not in (0, 90, 180, 270) then
    raise exception 'Use 90 degree rotations.' using errcode = '23514';
  end if;
  if exists (
    select 1 from jsonb_array_elements(cells) v
    cross join lateral (values ((v->>'x')::numeric), ((v->>'y')::numeric), ((v->>'z')::numeric)) coordinate(n)
    where n is null or n <> trunc(n) or n < 0 or n > 15
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
revoke all on function private.room_world_voxels(jsonb, integer, integer, integer, integer) from public, anon, authenticated;
grant execute on function private.room_world_voxels(jsonb, integer, integer, integer, integer) to authenticated;

create function private.validate_room_placement()
returns trigger language plpgsql security invoker set search_path = ''
as $$
declare model jsonb;
begin
  -- Serialize competing writes in a home before checking occupied cells.
  perform pg_advisory_xact_lock(hashtextextended(new.home_id::text, 0));
  select voxel_data into model from public.furniture
    where id = new.furniture_id and home_id = new.home_id;
  if not found then raise exception 'Furniture is unavailable in this home.' using errcode = '23503'; end if;

  if exists (
    select 1 from private.room_world_voxels(model, new.x, new.y, new.z, new.rotation) v
    where v.wx < 0 or v.wx >= 64 or v.wz < 0 or v.wz >= 64 or v.wy < 0 or v.wy >= 16
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
revoke all on function private.validate_room_placement() from public, anon, authenticated;
create trigger placed_furniture_validate
before insert or update of x, y, z, rotation, furniture_id on public.placed_furniture
for each row execute function private.validate_room_placement();

commit;
