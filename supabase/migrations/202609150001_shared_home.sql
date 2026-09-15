-- Apply through supabase db push; CLI migration history tracks this file.
begin;

create table public.profiles (
  id uuid primary key references auth.users(id),
  display_name text not null check (length(btrim(display_name)) > 0),
  created_at timestamptz not null default now()
);

create table public.homes (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) > 0),
  created_at timestamptz not null default now()
);

create table public.home_members (
  home_id uuid not null references public.homes(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  primary key (home_id, user_id)
);
create index home_members_user_home_idx on public.home_members(user_id, home_id);

create table public.furniture (
  id uuid primary key default gen_random_uuid(),
  home_id uuid not null references public.homes(id) on delete cascade,
  creator_id uuid not null references public.profiles(id),
  name text not null check (length(btrim(name)) > 0),
  voxel_data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, home_id)
);
create index furniture_home_created_idx on public.furniture(home_id, created_at desc);
create index furniture_creator_idx on public.furniture(creator_id);

create table public.placed_furniture (
  id uuid primary key default gen_random_uuid(),
  home_id uuid not null references public.homes(id) on delete cascade,
  furniture_id uuid not null,
  x integer not null,
  z integer not null,
  rotation integer not null check (rotation in (0, 90, 180, 270)),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Prevent references to furniture belonging to a different home.
  foreign key (furniture_id, home_id) references public.furniture(id, home_id) on delete cascade
);
create index placed_furniture_home_idx on public.placed_furniture(home_id);
create index placed_furniture_definition_idx on public.placed_furniture(furniture_id, home_id);
create index placed_furniture_creator_idx on public.placed_furniture(created_by);

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;

-- Only answers whether the *calling* user belongs to the supplied home.
-- Owned by postgres to avoid recursive home_members RLS. Not an exposed RPC.
create function private.is_home_member(target_home_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.home_members
    where home_id = target_home_id and user_id = (select auth.uid())
  );
$$;
alter function private.is_home_member(uuid) owner to postgres;
revoke all on function private.is_home_member(uuid) from public, anon, authenticated;
grant execute on function private.is_home_member(uuid) to authenticated;

create function private.set_updated_at()
returns trigger
language plpgsql security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function private.set_updated_at() from public, anon, authenticated;
create trigger furniture_updated_at before update on public.furniture
for each row execute function private.set_updated_at();
create trigger placed_furniture_updated_at before update on public.placed_furniture
for each row execute function private.set_updated_at();

alter table public.profiles enable row level security;
alter table public.homes enable row level security;
alter table public.home_members enable row level security;
alter table public.furniture enable row level security;
alter table public.placed_furniture enable row level security;

create policy profiles_shared_home_read on public.profiles
for select to authenticated using (
  exists (
    select 1 from public.home_members membership
    where membership.user_id = profiles.id
      and private.is_home_member(membership.home_id)
  )
);
create policy homes_member_read on public.homes
for select to authenticated using (private.is_home_member(id));
create policy home_members_member_read on public.home_members
for select to authenticated using (private.is_home_member(home_id));

create policy furniture_member_read on public.furniture
for select to authenticated using (private.is_home_member(home_id));
create policy furniture_member_insert on public.furniture
for insert to authenticated with check (
  private.is_home_member(home_id) and creator_id = (select auth.uid())
);
create policy furniture_member_update on public.furniture
for update to authenticated using (private.is_home_member(home_id))
with check (private.is_home_member(home_id));
create policy furniture_member_delete on public.furniture
for delete to authenticated using (private.is_home_member(home_id));

create policy placed_furniture_member_read on public.placed_furniture
for select to authenticated using (private.is_home_member(home_id));
create policy placed_furniture_member_insert on public.placed_furniture
for insert to authenticated with check (
  private.is_home_member(home_id) and created_by = (select auth.uid())
);
create policy placed_furniture_member_update on public.placed_furniture
for update to authenticated using (private.is_home_member(home_id))
with check (private.is_home_member(home_id));
create policy placed_furniture_member_delete on public.placed_furniture
for delete to authenticated using (private.is_home_member(home_id));

-- Explicit opt-in exposure: do not depend on automatic/default API grants.
-- Admin-only setup records have no API write grants or write policies.
revoke all on public.profiles, public.homes, public.home_members,
  public.furniture, public.placed_furniture from public, anon, authenticated;
grant usage on schema public to authenticated;
grant select on public.profiles, public.homes, public.home_members,
  public.furniture, public.placed_furniture to authenticated;
grant delete on public.furniture, public.placed_furniture to authenticated;
grant insert (home_id, creator_id, name, voxel_data) on public.furniture to authenticated;
grant update (name, voxel_data) on public.furniture to authenticated;
grant insert (home_id, furniture_id, x, z, rotation, created_by) on public.placed_furniture to authenticated;
grant update (x, z, rotation) on public.placed_furniture to authenticated;

commit;
