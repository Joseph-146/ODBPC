-- Run once in Supabase: SQL Editor -> New query -> paste -> Run.
-- The Host account is created by YOU (not by sign-up): put the Host email(s) in the
-- host_emails list below, then create that user in Authentication -> Users -> Add user.
-- Everyone who signs up in the app starts as Youth; choosing "Evangelist" creates a
-- request the Host approves in the app.

create table if not exists public.host_emails (email text primary key);
alter table public.host_emails enable row level security;   -- no policies = not readable from the app
insert into public.host_emails (email) values ('host@ourdailybread.app') on conflict do nothing;

create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  name       text not null default '',
  email      text,
  role       text not null default 'Youth' check (role in ('Host','Evangelist','Youth')),
  requested  text check (requested is null or requested = 'Evangelist'),
  bio        text default '',
  avatar     text default '',
  last_seen  bigint default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.app_data (
  id         text primary key,                 -- "key" for shared rows, "key:<user id>" for personal rows
  key        text not null,
  owner_id   uuid references auth.users(id) on delete cascade,  -- null = shared with everyone
  value      jsonb not null default 'null'::jsonb,
  updated_by uuid,
  updated_at timestamptz not null default now()
);

create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as
$$ select role from public.profiles where id = auth.uid() $$;

-- Create a profile automatically when someone signs up
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, name, email, role, requested)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data->>'name',''), split_part(new.email,'@',1)),
    new.email,
    case when lower(new.email) in (select email from public.host_emails) then 'Host' else 'Youth' end,
    case when new.raw_user_meta_data->>'requested' = 'Evangelist' then 'Evangelist' end
  );
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Only the one allowed Host email can ever hold the Host role. Only a Host can change roles/emails (the SQL editor, with no logged-in user, is also allowed)
create or replace function public.guard_profile() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.role = 'Host' and old.role <> 'Host' and auth.uid() is not null then
    raise exception 'There is only one Host account';
  end if;
  -- never allow the last Host to be demoted
  if old.role = 'Host' and new.role <> 'Host'
     and not exists (select 1 from public.profiles where role = 'Host' and id <> old.id) then
    raise exception 'There must always be at least one Host';
  end if;
  if auth.uid() is not null and public.my_role() is distinct from 'Host' then
    new.role := old.role;
    new.email := old.email;
    if new.requested is distinct from old.requested and new.requested is not null then
      new.requested := 'Evangelist';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists guard_profile on public.profiles;
create trigger guard_profile before update on public.profiles
  for each row execute function public.guard_profile();

-- Host-only: delete a member's login (cascades to their profile and personal data)
create or replace function public.admin_delete_user(uid uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if public.my_role() is distinct from 'Host' then raise exception 'Only the Host can remove members'; end if;
  if uid = auth.uid() then raise exception 'You cannot remove yourself'; end if;
  delete from auth.users where id = uid;
end $$;
revoke all on function public.admin_delete_user(uuid) from public, anon;
grant execute on function public.admin_delete_user(uuid) to authenticated;

-- Row Level Security: signed-in users only, nothing for the anonymous role
alter table public.profiles enable row level security;
alter table public.app_data enable row level security;

drop policy if exists profiles_read   on public.profiles;
drop policy if exists profiles_update on public.profiles;
drop policy if exists profiles_delete on public.profiles;
create policy profiles_read   on public.profiles for select to authenticated using (true);
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid() or public.my_role() = 'Host')
  with check (id = auth.uid() or public.my_role() = 'Host');
create policy profiles_delete on public.profiles for delete to authenticated using (public.my_role() = 'Host');

drop policy if exists data_read   on public.app_data;
drop policy if exists data_insert on public.app_data;
drop policy if exists data_update on public.app_data;
create policy data_read on public.app_data for select to authenticated
  using (owner_id is null or owner_id = auth.uid());
create policy data_insert on public.app_data for insert to authenticated
  with check (
    updated_by = auth.uid()
    and (owner_id is null or owner_id = auth.uid())
    and (key not in ('announcements','give','upSongs','sgLinks') or public.my_role() in ('Host','Evangelist'))
  );
create policy data_update on public.app_data for update to authenticated
  using (owner_id is null or owner_id = auth.uid())
  with check (
    updated_by = auth.uid()
    and (owner_id is null or owner_id = auth.uid())
    and (key not in ('announcements','give','upSongs','sgLinks') or public.my_role() in ('Host','Evangelist'))
  );

-- Live updates between devices
do $$ begin
  alter publication supabase_realtime add table public.app_data;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.profiles;
exception when duplicate_object then null; end $$;

-- If the Host already signed up before you ran this, promote them:
update public.profiles set role = 'Host' where lower(email) in (select email from public.host_emails);
