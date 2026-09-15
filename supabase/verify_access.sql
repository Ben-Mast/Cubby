-- Run after CLI push/seed: supabase db query --linked --file supabase/verify_access.sql
-- Auth UUIDs resolve from the configured login emails. All probes are rolled back.
-- This deliberately SET ROLEs to API roles: testing as postgres alone bypasses RLS.
begin;
create temporary table phase3_context (
  user_one uuid, user_two uuid, home_id uuid,
  furniture_id uuid, placement_id uuid
) on commit drop;
insert into phase3_context(user_one, user_two, home_id)
select u1.id, u2.id, m.home_id
from auth.users u1
cross join auth.users u2
join public.home_members m on m.user_id = u1.id
where lower(u1.email) = lower('ben@cubby.example')
  and lower(u2.email) = lower('partner@cubby.example');
do $$
begin
  if (select count(*) from phase3_context) <> 1 or not exists (
    select 1 from public.home_members m join phase3_context c
    on m.home_id=c.home_id and m.user_id=c.user_two
  ) then raise exception 'Both users must belong to exactly the same MVP home'; end if;
end;
$$;
grant select on phase3_context to anon;
grant select, update on phase3_context to authenticated;

set local role anon;
select set_config('request.jwt.claim.sub', '', true);
do $$
begin
  begin
    perform 1 from public.furniture;
    raise exception 'FAIL: anonymous SELECT was granted';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.furniture(home_id,creator_id,name,voxel_data)
    select home_id,user_one,'Anonymous probe','{}'::jsonb from phase3_context;
    raise exception 'FAIL: anonymous INSERT succeeded';
  exception when insufficient_privilege then null;
  end;
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', (select user_one::text from phase3_context), true);
do $$
declare
  context phase3_context%rowtype;
  probe_furniture uuid;
  probe_placement uuid;
begin
  select * into context from phase3_context;
  if not exists (select 1 from public.homes where id=context.home_id) then
    raise exception 'FAIL: member cannot read home';
  end if;
  if (select count(*) from public.home_members where home_id=context.home_id) <> 2 then
    raise exception 'FAIL: member cannot read both memberships';
  end if;
  if (select count(*) from public.profiles where id in (context.user_one,context.user_two)) <> 2 then
    raise exception 'FAIL: member cannot read shared profiles';
  end if;
  insert into public.furniture(home_id,creator_id,name,voxel_data)
  values (context.home_id,context.user_one,'Phase 3 probe',
    '{"version":1,"size":[16,16,16],"voxels":[{"x":0,"y":0,"z":0,"color":"#5b4bdb"}]}')
  returning id into probe_furniture;
  insert into public.placed_furniture(home_id,furniture_id,x,z,rotation,created_by)
  values (context.home_id,probe_furniture,0,0,0,context.user_one)
  returning id into probe_placement;
  update phase3_context set furniture_id=probe_furniture,placement_id=probe_placement;
end;
$$;

select set_config('request.jwt.claim.sub', (select user_two::text from phase3_context), true);
do $$
declare
  context phase3_context%rowtype;
  affected integer;
begin
  select * into context from phase3_context;
  if not exists (select 1 from public.homes where id=context.home_id) then
    raise exception 'FAIL: second member resolves a different home';
  end if;
  update public.furniture set name='Edited by second member' where id=context.furniture_id;
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'FAIL: second member cannot edit shared furniture'; end if;
  update public.placed_furniture set x=1,rotation=90 where id=context.placement_id;
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'FAIL: second member cannot edit placement'; end if;
  begin
    insert into public.home_members(home_id,user_id) values (context.home_id,gen_random_uuid());
    raise exception 'FAIL: frontend can change home membership';
  exception when insufficient_privilege then null;
  end;
end;
$$;

-- Simulate an authenticated UID with no home membership; no third Auth user needed.
select set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
do $$
declare
  context phase3_context%rowtype;
  affected integer;
begin
  select * into context from phase3_context;
  if exists (select 1 from public.homes where id=context.home_id)
    or exists (select 1 from public.home_members where home_id=context.home_id)
    or exists (select 1 from public.furniture where id=context.furniture_id)
    or exists (select 1 from public.placed_furniture where id=context.placement_id) then
    raise exception 'FAIL: non-member can read shared data';
  end if;
  update public.placed_furniture set x=9 where id=context.placement_id;
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'FAIL: non-member can edit placement'; end if;
  begin
    insert into public.furniture(home_id,creator_id,name,voxel_data)
    values (context.home_id,auth.uid(),'Non-member probe','{}');
    raise exception 'FAIL: non-member can insert furniture';
  exception when insufficient_privilege then null;
  end;
end;
$$;

select set_config('request.jwt.claim.sub', (select user_two::text from phase3_context), true);
do $$
declare
  context phase3_context%rowtype;
  affected integer;
begin
  select * into context from phase3_context;
  delete from public.furniture where id=context.furniture_id;
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'FAIL: member cannot delete furniture'; end if;
  if exists (select 1 from public.placed_furniture where id=context.placement_id) then
    raise exception 'FAIL: furniture delete did not cascade to placement';
  end if;
end;
$$;
reset role;
select 'Phase 3 role-based access checks passed; probe changes will be rolled back' as result;
rollback;
