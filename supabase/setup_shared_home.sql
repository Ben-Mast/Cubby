-- CLI seed: supabase db push --linked --include-seed (after a matching --dry-run).
-- Existing Auth users are manually created. Emails/names must match identities.ts.
-- These internal login emails are configuration, not secrets. Never add passwords.
begin;
do $$
declare
  email_one text := 'ben@cubby.example';
  email_two text := 'partner@cubby.example';
  user_one uuid;
  user_two uuid;
  name_one text := 'Ben';
  name_two text := 'Girlfriend';
  shared_home uuid;
begin
  if lower(email_one) = lower(email_two) then
    raise exception 'Two distinct internal login emails are required';
  end if;
  if (select count(*) from auth.users where lower(email) = lower(email_one)) <> 1
    or (select count(*) from auth.users where lower(email) = lower(email_two)) <> 1 then
    raise exception 'Each configured login email must match exactly one existing Auth user';
  end if;
  select id into strict user_one from auth.users where lower(email) = lower(email_one);
  select id into strict user_two from auth.users where lower(email) = lower(email_two);
  if user_one = user_two then
    raise exception 'Two distinct existing Auth users are required';
  end if;
  if (select count(*) from auth.users where id in (user_one, user_two)) <> 2 then
    raise exception 'Both UUIDs must exist in auth.users';
  end if;
  if (select count(*) from public.homes) > 1 then
    raise exception 'MVP expects one home; inspect existing data before setup';
  end if;
  select id into shared_home from public.homes;
  if shared_home is null then
    insert into public.homes(name) values ('Our Cubby') returning id into shared_home;
  end if;
  if exists (select 1 from public.home_members
    where user_id not in (user_one, user_two) or home_id <> shared_home) then
    raise exception 'Unexpected membership exists; setup will not change access silently';
  end if;
  insert into public.profiles(id, display_name) values (user_one, name_one), (user_two, name_two)
  on conflict (id) do update set display_name = excluded.display_name;
  insert into public.home_members(home_id, user_id) values (shared_home, user_one), (shared_home, user_two)
  on conflict (home_id, user_id) do nothing;
end;
$$;
commit;

-- CLI output shows the shared home and resolved users; no frontend home env value.
select h.id as home_id, h.name, m.user_id, p.display_name
from public.homes h
join public.home_members m on m.home_id = h.id
join public.profiles p on p.id = m.user_id
order by p.display_name;
