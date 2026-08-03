-- Multi-coach membership (Phase 1).
-- Creator is Admin; same user may hold multiple roles for testing.

create type public.roster_role as enum (
  'admin',
  'varsity_coach',
  'jv_coach',
  'fr_soph_coach',
  'assistant'
);

create table if not exists public.roster_members (
  id uuid primary key default gen_random_uuid(),
  roster_id uuid not null references public.rosters (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.roster_role not null,
  created_at timestamptz not null default now(),
  unique (roster_id, user_id, role)
);

create index if not exists roster_members_user_id_idx
  on public.roster_members (user_id);

create index if not exists roster_members_roster_id_idx
  on public.roster_members (roster_id);

-- At most one head-coach / admin role seat per roster (assistants capped at 3).
create unique index if not exists roster_members_one_admin_per_roster
  on public.roster_members (roster_id)
  where role = 'admin';

create unique index if not exists roster_members_one_varsity_per_roster
  on public.roster_members (roster_id)
  where role = 'varsity_coach';

create unique index if not exists roster_members_one_jv_per_roster
  on public.roster_members (roster_id)
  where role = 'jv_coach';

create unique index if not exists roster_members_one_fr_soph_per_roster
  on public.roster_members (roster_id)
  where role = 'fr_soph_coach';

create or replace function public.enforce_assistant_cap()
returns trigger
language plpgsql
as $$
declare
  assistant_count integer;
begin
  if new.role <> 'assistant' then
    return new;
  end if;
  select count(*)::integer into assistant_count
  from public.roster_members
  where roster_id = new.roster_id
    and role = 'assistant'
    and id is distinct from new.id;
  if assistant_count >= 3 then
    raise exception 'A roster may have at most 3 assistants';
  end if;
  return new;
end;
$$;

drop trigger if exists roster_members_assistant_cap on public.roster_members;
create trigger roster_members_assistant_cap
  before insert or update on public.roster_members
  for each row execute procedure public.enforce_assistant_cap();

-- Helpers for RLS (security definer avoids recursive policy checks).
create or replace function public.is_roster_member(p_roster_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.roster_members m
    where m.roster_id = p_roster_id
      and m.user_id = auth.uid()
  );
$$;

create or replace function public.is_roster_admin(p_roster_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.roster_members m
    where m.roster_id = p_roster_id
      and m.user_id = auth.uid()
      and m.role = 'admin'
  )
  or exists (
    select 1
    from public.rosters r
    where r.id = p_roster_id
      and r.owner_id = auth.uid()
  );
$$;

revoke all on function public.is_roster_member(uuid) from public;
revoke all on function public.is_roster_admin(uuid) from public;
grant execute on function public.is_roster_member(uuid) to authenticated;
grant execute on function public.is_roster_admin(uuid) to authenticated;

-- Backfill: roster owner becomes admin member.
insert into public.roster_members (roster_id, user_id, role)
select r.id, r.owner_id, 'admin'::public.roster_role
from public.rosters r
on conflict (roster_id, user_id, role) do nothing;

-- Auto-add admin when a roster is created.
create or replace function public.handle_roster_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.roster_members (roster_id, user_id, role)
  values (new.id, new.owner_id, 'admin')
  on conflict (roster_id, user_id, role) do nothing;
  return new;
end;
$$;

drop trigger if exists on_roster_created on public.rosters;
create trigger on_roster_created
  after insert on public.rosters
  for each row execute procedure public.handle_roster_created();

alter table public.roster_members enable row level security;

create policy "Members can select roster memberships"
  on public.roster_members for select
  using (
    user_id = auth.uid()
    or public.is_roster_member(roster_id)
  );

create policy "Admins can insert roster memberships"
  on public.roster_members for insert
  with check (public.is_roster_admin(roster_id));

create policy "Admins can update roster memberships"
  on public.roster_members for update
  using (public.is_roster_admin(roster_id));

create policy "Admins can delete roster memberships"
  on public.roster_members for delete
  using (public.is_roster_admin(roster_id));

-- Rosters: members can read; owner/admin can write (unchanged owner insert).
drop policy if exists "Owners can select own rosters" on public.rosters;
create policy "Members can select rosters"
  on public.rosters for select
  using (public.is_roster_member(id) or owner_id = auth.uid());

drop policy if exists "Owners can update own rosters" on public.rosters;
create policy "Admins can update rosters"
  on public.rosters for update
  using (public.is_roster_admin(id));

drop policy if exists "Owners can delete own rosters" on public.rosters;
create policy "Admins can delete rosters"
  on public.rosters for delete
  using (public.is_roster_admin(id));

-- Players: members read; admin/owner write (Phase 1 shared dataset).
drop policy if exists "Owners can select players in own rosters" on public.players;
create policy "Members can select players"
  on public.players for select
  using (public.is_roster_member(roster_id));

drop policy if exists "Owners can insert players in own rosters" on public.players;
create policy "Admins can insert players"
  on public.players for insert
  with check (public.is_roster_admin(roster_id));

drop policy if exists "Owners can update players in own rosters" on public.players;
create policy "Admins can update players"
  on public.players for update
  using (public.is_roster_admin(roster_id));

drop policy if exists "Owners can delete players in own rosters" on public.players;
create policy "Admins can delete players"
  on public.players for delete
  using (public.is_roster_admin(roster_id));

-- Depth / sub / formation: same member-read, admin-write pattern.
drop policy if exists "Owners can select depth chart entries" on public.depth_chart_entries;
create policy "Members can select depth chart entries"
  on public.depth_chart_entries for select
  using (public.is_roster_member(roster_id));

drop policy if exists "Owners can insert depth chart entries" on public.depth_chart_entries;
create policy "Admins can insert depth chart entries"
  on public.depth_chart_entries for insert
  with check (public.is_roster_admin(roster_id));

drop policy if exists "Owners can update depth chart entries" on public.depth_chart_entries;
create policy "Admins can update depth chart entries"
  on public.depth_chart_entries for update
  using (public.is_roster_admin(roster_id));

drop policy if exists "Owners can delete depth chart entries" on public.depth_chart_entries;
create policy "Admins can delete depth chart entries"
  on public.depth_chart_entries for delete
  using (public.is_roster_admin(roster_id));

drop policy if exists "Owners can select sub order entries" on public.sub_order_entries;
create policy "Members can select sub order entries"
  on public.sub_order_entries for select
  using (public.is_roster_member(roster_id));

drop policy if exists "Owners can insert sub order entries" on public.sub_order_entries;
create policy "Admins can insert sub order entries"
  on public.sub_order_entries for insert
  with check (public.is_roster_admin(roster_id));

drop policy if exists "Owners can update sub order entries" on public.sub_order_entries;
create policy "Admins can update sub order entries"
  on public.sub_order_entries for update
  using (public.is_roster_admin(roster_id));

drop policy if exists "Owners can delete sub order entries" on public.sub_order_entries;
create policy "Admins can delete sub order entries"
  on public.sub_order_entries for delete
  using (public.is_roster_admin(roster_id));

drop policy if exists "Owners can select formation assignments" on public.formation_assignments;
create policy "Members can select formation assignments"
  on public.formation_assignments for select
  using (public.is_roster_member(roster_id));

drop policy if exists "Owners can insert formation assignments" on public.formation_assignments;
create policy "Admins can insert formation assignments"
  on public.formation_assignments for insert
  with check (public.is_roster_admin(roster_id));

drop policy if exists "Owners can update formation assignments" on public.formation_assignments;
create policy "Admins can update formation assignments"
  on public.formation_assignments for update
  using (public.is_roster_admin(roster_id));

drop policy if exists "Owners can delete formation assignments" on public.formation_assignments;
create policy "Admins can delete formation assignments"
  on public.formation_assignments for delete
  using (public.is_roster_admin(roster_id));

comment on table public.roster_members is
  'Coach/admin memberships for a tryout roster. One user may hold multiple roles.';
