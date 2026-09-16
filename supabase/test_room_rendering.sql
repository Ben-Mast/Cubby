-- OPTIONAL test data, not a migration/default seed. Do not run until reviewed.
-- Create an asymmetric furniture design through the app first. Copy its UUID
-- from /furniture/<UUID>/edit and set design_id below. No Auth UUID is needed.
-- Default ROLLBACK previews the exact inserts without persisting test data.
-- After reviewing the output, change the final ROLLBACK to COMMIT to apply.
begin;
do $$
declare
  login_email text := 'partner@cubby.example'; -- match identities.ts
  design_id uuid := '554d6ff8-d659-44f3-833f-665c3d4b2f45'; -- existing furniture UUID
  auth_user_id uuid;
  shared_home_id uuid;
begin
  select id into strict auth_user_id from auth.users where lower(email) = lower(login_email);
  select home_id into strict shared_home_id from public.home_members where user_id = auth_user_id;
  if not exists (select 1 from public.furniture where id = design_id and home_id = shared_home_id) then
    raise exception 'Choose an existing furniture UUID in the configured user''s shared home.';
  end if;
  -- Do not overwrite any existing rows, even on repeated runs.
  if exists (
    select 1 from public.placed_furniture
    where id in ('f6000000-0000-4000-8000-000000000001', 'f6000000-0000-4000-8000-000000000002',
      'f6000000-0000-4000-8000-000000000003', 'f6000000-0000-4000-8000-000000000004')
    and (home_id <> shared_home_id or furniture_id <> design_id or created_by <> auth_user_id)
  ) then raise exception 'Reserved test IDs already belong to different data. Stop and inspect.'; end if;
  insert into public.placed_furniture(id, home_id, furniture_id, x, y, z, rotation, created_by)
  values
    ('f6000000-0000-4000-8000-000000000001', shared_home_id, design_id, 12, 0, 12, 0, auth_user_id),
    ('f6000000-0000-4000-8000-000000000002', shared_home_id, design_id, 36, 0, 12, 90, auth_user_id),
    ('f6000000-0000-4000-8000-000000000003', shared_home_id, design_id, 12, 0, 36, 180, auth_user_id),
    ('f6000000-0000-4000-8000-000000000004', shared_home_id, design_id, 36, 0, 36, 270, auth_user_id)
  on conflict (id) do nothing;
end;
$$;
select id, home_id, furniture_id, x, y, z, rotation from public.placed_furniture
where id in ('f6000000-0000-4000-8000-000000000001', 'f6000000-0000-4000-8000-000000000002',
  'f6000000-0000-4000-8000-000000000003', 'f6000000-0000-4000-8000-000000000004') order by id;
rollback;

-- Later cleanup (only these four reserved IDs; leaves the furniture design intact):
delete from public.placed_furniture where id in (
  'f6000000-0000-4000-8000-000000000001', 'f6000000-0000-4000-8000-000000000002',
  'f6000000-0000-4000-8000-000000000003', 'f6000000-0000-4000-8000-000000000004');
