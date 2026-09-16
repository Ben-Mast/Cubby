-- Keep the existing Auth identity and furniture creator IDs unchanged.
-- Furniture creator labels are read from profiles, not stored on each item.
do $$
declare
  gabby_id uuid;
begin
  if (select count(*) from auth.users where lower(email) = 'partner@cubby.example') <> 1 then
    raise exception 'Expected exactly one existing Auth user for Gabby';
  end if;

  select id into gabby_id from auth.users where lower(email) = 'partner@cubby.example';
  update public.profiles set display_name = 'Gabby' where id = gabby_id;
  if not found then
    raise exception 'Gabby profile is missing; run shared-home setup first';
  end if;
end;
$$;
