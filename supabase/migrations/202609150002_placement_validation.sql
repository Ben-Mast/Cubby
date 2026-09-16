-- Phase 7: authoritative placement validation; no table/RLS/API changes.
-- Fixed dimensions mirror src/features/room/config.ts (16 x 16; voxel unit 0.25).
begin;

create function private.voxel_footprint(model jsonb)
returns table(width numeric, depth numeric)
language plpgsql immutable security invoker set search_path = ''
as $$
declare
  cells jsonb;
begin
  if model->>'version' is distinct from '1' or model->'size' is distinct from '[16,16,16]'::jsonb
    or jsonb_typeof(model->'voxels') is distinct from 'array' then
    raise exception 'Furniture has invalid voxel data.' using errcode = '23514';
  end if;
  cells := model->'voxels';
  if jsonb_array_length(cells) = 0 or jsonb_array_length(cells) > 4096 then
    raise exception 'Furniture must contain voxels.' using errcode = '23514';
  end if;
  if exists (
    select 1 from jsonb_array_elements(cells) v cross join lateral
      (values ((v->>'x')::numeric), ((v->>'y')::numeric), ((v->>'z')::numeric)) coordinate(n)
    where n is null or n <> trunc(n) or n < 0 or n > 15
  ) then raise exception 'Furniture has invalid voxel coordinates.' using errcode = '23514'; end if;
  return query select (max((v->>'x')::numeric) - min((v->>'x')::numeric) + 1) * 0.25,
    (max((v->>'z')::numeric) - min((v->>'z')::numeric) + 1) * 0.25
    from jsonb_array_elements(cells) v;
exception when invalid_text_representation then
  raise exception 'Furniture has invalid voxel coordinates.' using errcode = '23514';
end;
$$;
revoke all on function private.voxel_footprint(jsonb) from public, anon, authenticated;
grant execute on function private.voxel_footprint(jsonb) to authenticated;

create function private.validate_room_placement()
returns trigger language plpgsql security invoker set search_path = ''
as $$
declare
  model jsonb;
  item_width numeric;
  item_depth numeric;
  swap numeric;
begin
  -- Serialize competing INSERT/UPDATE operations in this home. Subsequent
  -- queries in this volatile trigger see earlier committed placements.
  perform pg_advisory_xact_lock(hashtextextended(new.home_id::text, 0));
  select voxel_data into model from public.furniture
    where id = new.furniture_id and home_id = new.home_id;
  if not found then raise exception 'Furniture is unavailable in this home.' using errcode = '23503'; end if;
  select width, depth into item_width, item_depth from private.voxel_footprint(model);
  if new.rotation not in (0,90,180,270) then
    raise exception 'Use 90 degree rotations.' using errcode = '23514';
  end if;
  if new.rotation in (90,270) then swap := item_width; item_width := item_depth; item_depth := swap; end if;
  if new.x < 0 or new.z < 0 or new.x + item_width > 16 or new.z + item_depth > 16 then
    raise exception 'Furniture must fit inside the room.' using errcode = '23514';
  end if;
  if exists (
    select 1 from public.placed_furniture p
    join public.furniture f on f.id = p.furniture_id and f.home_id = p.home_id
    cross join lateral private.voxel_footprint(f.voxel_data) footprint
    where p.home_id = new.home_id and p.id <> new.id
      and new.x < p.x + case when p.rotation in (90,270) then footprint.depth else footprint.width end
      and new.x + item_width > p.x
      and new.z < p.z + case when p.rotation in (90,270) then footprint.width else footprint.depth end
      and new.z + item_depth > p.z
  ) then raise exception 'Furniture overlaps another placed item.' using errcode = '23514'; end if;
  return new;
end;
$$;
revoke all on function private.validate_room_placement() from public, anon, authenticated;
create trigger placed_furniture_validate
before insert or update of x, z, rotation on public.placed_furniture
for each row execute function private.validate_room_placement();

commit;
