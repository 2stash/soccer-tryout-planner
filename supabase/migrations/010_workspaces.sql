-- Phase 2: per-coach workspaces + assignment overlays.
-- Shared player identity stays on players; squad/rank/pin move to player_assignments.
-- Depth + sub order become workspace-scoped.

do $$ begin
  create type public.workspace_kind as enum (
    'personal',
    'master_varsity',
    'master_jv',
    'master_fr_soph'
  );
exception
  when duplicate_object then null;
end $$;

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  roster_id uuid not null references public.rosters (id) on delete cascade,
  kind public.workspace_kind not null,
  -- Set only for personal workspaces (one per user per roster).
  user_id uuid references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint workspaces_personal_user_chk check (
    (kind = 'personal' and user_id is not null)
    or (kind <> 'personal' and user_id is null)
  )
);

create unique index if not exists workspaces_one_master_per_kind
  on public.workspaces (roster_id, kind)
  where kind <> 'personal';

create unique index if not exists workspaces_one_personal_per_user
  on public.workspaces (roster_id, user_id)
  where kind = 'personal';

create index if not exists workspaces_roster_id_idx
  on public.workspaces (roster_id);

create table if not exists public.player_assignments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  player_id uuid not null references public.players (id) on delete cascade,
  squad_team text check (
    squad_team is null
    or squad_team in ('varsity', 'jv', 'fr_soph', 'unavailable')
  ),
  team_rank integer,
  available_pinned boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, player_id)
);

create index if not exists player_assignments_workspace_id_idx
  on public.player_assignments (workspace_id);

create index if not exists player_assignments_player_id_idx
  on public.player_assignments (player_id);

drop trigger if exists player_assignments_set_updated_at on public.player_assignments;
create trigger player_assignments_set_updated_at
  before update on public.player_assignments
  for each row execute procedure public.set_updated_at();

-- Scope depth / sub order by workspace.
alter table public.depth_chart_entries
  add column if not exists workspace_id uuid references public.workspaces (id) on delete cascade;

alter table public.sub_order_entries
  add column if not exists workspace_id uuid references public.workspaces (id) on delete cascade;

alter table public.formation_assignments
  add column if not exists workspace_id uuid references public.workspaces (id) on delete cascade;

-- Seed masters for every roster.
insert into public.workspaces (roster_id, kind)
select r.id, k.kind
from public.rosters r
cross join (
  values
    ('master_varsity'::public.workspace_kind),
    ('master_jv'::public.workspace_kind),
    ('master_fr_soph'::public.workspace_kind)
) as k(kind)
where not exists (
  select 1
  from public.workspaces w
  where w.roster_id = r.id
    and w.kind = k.kind
);

-- Seed personal workspace for every distinct member user.
insert into public.workspaces (roster_id, kind, user_id)
select distinct m.roster_id, 'personal'::public.workspace_kind, m.user_id
from public.roster_members m
where not exists (
  select 1
  from public.workspaces w
  where w.roster_id = m.roster_id
    and w.kind = 'personal'
    and w.user_id = m.user_id
);

-- Migrate assignment state into owner personal + all three masters.
insert into public.player_assignments (
  workspace_id,
  player_id,
  squad_team,
  team_rank,
  available_pinned
)
select
  w.id,
  p.id,
  p.squad_team,
  p.team_rank,
  coalesce(p.available_pinned, false)
from public.players p
join public.rosters r on r.id = p.roster_id
join public.workspaces w
  on w.roster_id = p.roster_id
 and (
   (w.kind = 'personal' and w.user_id = r.owner_id)
   or w.kind in ('master_varsity', 'master_jv', 'master_fr_soph')
 )
on conflict (workspace_id, player_id) do nothing;

-- Drop legacy uniques BEFORE copying into master workspaces.
-- Postgres may truncate long constraint names (…position_number_pl_key).
do $$
declare
  con record;
begin
  for con in
    select c.conname, c.conrelid::regclass as tbl
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and c.contype = 'u'
      and t.relname in (
        'depth_chart_entries',
        'sub_order_entries',
        'formation_assignments'
      )
      and c.conname not like '%workspace_unique'
  loop
    execute format('alter table %s drop constraint if exists %I', con.tbl, con.conname);
  end loop;
end $$;

-- Attach existing depth rows to owner personal, then copy to masters.
update public.depth_chart_entries d
set workspace_id = w.id
from public.rosters r
join public.workspaces w
  on w.roster_id = r.id
 and w.kind = 'personal'
 and w.user_id = r.owner_id
where d.roster_id = r.id
  and d.workspace_id is null;

insert into public.depth_chart_entries (
  roster_id,
  workspace_id,
  squad_team,
  position_number,
  player_id,
  sort_order,
  created_at,
  updated_at
)
select
  d.roster_id,
  mw.id,
  d.squad_team,
  d.position_number,
  d.player_id,
  d.sort_order,
  d.created_at,
  d.updated_at
from public.depth_chart_entries d
join public.workspaces pw on pw.id = d.workspace_id and pw.kind = 'personal'
join public.workspaces mw
  on mw.roster_id = d.roster_id
 and mw.kind in ('master_varsity', 'master_jv', 'master_fr_soph')
where not exists (
  select 1
  from public.depth_chart_entries x
  where x.workspace_id = mw.id
    and x.squad_team = d.squad_team
    and x.position_number = d.position_number
    and x.player_id = d.player_id
);

-- Same for sub order.
update public.sub_order_entries s
set workspace_id = w.id
from public.rosters r
join public.workspaces w
  on w.roster_id = r.id
 and w.kind = 'personal'
 and w.user_id = r.owner_id
where s.roster_id = r.id
  and s.workspace_id is null;

insert into public.sub_order_entries (
  roster_id,
  workspace_id,
  squad_team,
  player_id,
  sort_order,
  created_at,
  updated_at
)
select
  s.roster_id,
  mw.id,
  s.squad_team,
  s.player_id,
  s.sort_order,
  s.created_at,
  s.updated_at
from public.sub_order_entries s
join public.workspaces pw on pw.id = s.workspace_id and pw.kind = 'personal'
join public.workspaces mw
  on mw.roster_id = s.roster_id
 and mw.kind in ('master_varsity', 'master_jv', 'master_fr_soph')
where not exists (
  select 1
  from public.sub_order_entries x
  where x.workspace_id = mw.id
    and x.squad_team = s.squad_team
    and x.player_id = s.player_id
);

-- Formation assignments (if any).
update public.formation_assignments f
set workspace_id = w.id
from public.rosters r
join public.workspaces w
  on w.roster_id = r.id
 and w.kind = 'personal'
 and w.user_id = r.owner_id
where f.roster_id = r.id
  and f.workspace_id is null;

insert into public.formation_assignments (
  roster_id,
  workspace_id,
  squad_team,
  slot_number,
  player_id,
  depth_order,
  created_at
)
select
  f.roster_id,
  mw.id,
  f.squad_team,
  f.slot_number,
  f.player_id,
  f.depth_order,
  f.created_at
from public.formation_assignments f
join public.workspaces pw on pw.id = f.workspace_id and pw.kind = 'personal'
join public.workspaces mw
  on mw.roster_id = f.roster_id
 and mw.kind in ('master_varsity', 'master_jv', 'master_fr_soph')
where f.workspace_id is not null
  and not exists (
    select 1
    from public.formation_assignments x
    where x.workspace_id = mw.id
      and x.squad_team = f.squad_team
      and x.player_id = f.player_id
  );

-- Require workspace_id going forward.
do $$
begin
  if not exists (
    select 1 from public.depth_chart_entries where workspace_id is null
  ) then
    alter table public.depth_chart_entries
      alter column workspace_id set not null;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from public.sub_order_entries where workspace_id is null
  ) then
    alter table public.sub_order_entries
      alter column workspace_id set not null;
  end if;
end $$;

-- Formation may be empty; only enforce NOT NULL when all rows have values.
do $$
begin
  if not exists (
    select 1 from public.formation_assignments where workspace_id is null
  ) then
    alter table public.formation_assignments
      alter column workspace_id set not null;
  end if;
end $$;

-- Workspace-scoped unique constraints.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'depth_chart_entries_workspace_unique'
  ) then
    alter table public.depth_chart_entries
      add constraint depth_chart_entries_workspace_unique
      unique (workspace_id, squad_team, position_number, player_id);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'sub_order_entries_workspace_unique'
  ) then
    alter table public.sub_order_entries
      add constraint sub_order_entries_workspace_unique
      unique (workspace_id, squad_team, player_id);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'formation_assignments_workspace_unique'
  ) then
    alter table public.formation_assignments
      add constraint formation_assignments_workspace_unique
      unique (workspace_id, squad_team, player_id);
  end if;
end $$;

create index if not exists depth_chart_entries_workspace_lookup_idx
  on public.depth_chart_entries (workspace_id, squad_team, position_number, sort_order);

create index if not exists sub_order_entries_workspace_lookup_idx
  on public.sub_order_entries (workspace_id, squad_team, sort_order);

-- Helpers: can read / edit a workspace.
create or replace function public.can_read_workspace(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.workspaces w
    where w.id = p_workspace_id
      and public.is_roster_member(w.roster_id)
  );
$$;

create or replace function public.can_edit_workspace(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.workspaces w
    where w.id = p_workspace_id
      and (
        (
          w.kind = 'personal'
          and w.user_id = auth.uid()
        )
        or (
          w.kind = 'master_varsity'
          and (
            public.is_roster_admin(w.roster_id)
            or exists (
              select 1 from public.roster_members m
              where m.roster_id = w.roster_id
                and m.user_id = auth.uid()
                and m.role = 'varsity_coach'
            )
          )
        )
        or (
          w.kind = 'master_jv'
          and (
            public.is_roster_admin(w.roster_id)
            or exists (
              select 1 from public.roster_members m
              where m.roster_id = w.roster_id
                and m.user_id = auth.uid()
                and m.role = 'jv_coach'
            )
          )
        )
        or (
          w.kind = 'master_fr_soph'
          and (
            public.is_roster_admin(w.roster_id)
            or exists (
              select 1 from public.roster_members m
              where m.roster_id = w.roster_id
                and m.user_id = auth.uid()
                and m.role = 'fr_soph_coach'
            )
          )
        )
      )
  );
$$;

revoke all on function public.can_read_workspace(uuid) from public;
revoke all on function public.can_edit_workspace(uuid) from public;
grant execute on function public.can_read_workspace(uuid) to authenticated;
grant execute on function public.can_edit_workspace(uuid) to authenticated;

-- Auto-create masters when a roster is created (extend existing trigger).
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

  insert into public.workspaces (roster_id, kind)
  select new.id, k.kind
  from (
    values
      ('master_varsity'::public.workspace_kind),
      ('master_jv'::public.workspace_kind),
      ('master_fr_soph'::public.workspace_kind)
  ) as k(kind)
  where not exists (
    select 1 from public.workspaces w
    where w.roster_id = new.id and w.kind = k.kind
  );

  insert into public.workspaces (roster_id, kind, user_id)
  select new.id, 'personal'::public.workspace_kind, new.owner_id
  where not exists (
    select 1 from public.workspaces w
    where w.roster_id = new.id
      and w.kind = 'personal'
      and w.user_id = new.owner_id
  );

  return new;
end;
$$;

-- Auto-create personal workspace when a membership is added.
create or replace function public.handle_roster_member_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.workspaces (roster_id, kind, user_id)
  select new.roster_id, 'personal'::public.workspace_kind, new.user_id
  where not exists (
    select 1 from public.workspaces w
    where w.roster_id = new.roster_id
      and w.kind = 'personal'
      and w.user_id = new.user_id
  );
  return new;
end;
$$;

drop trigger if exists on_roster_member_created on public.roster_members;
create trigger on_roster_member_created
  after insert on public.roster_members
  for each row execute procedure public.handle_roster_member_created();

-- RLS
alter table public.workspaces enable row level security;
alter table public.player_assignments enable row level security;

drop policy if exists "Members can select workspaces" on public.workspaces;
create policy "Members can select workspaces"
  on public.workspaces for select
  using (public.is_roster_member(roster_id));

drop policy if exists "Admins can insert workspaces" on public.workspaces;
create policy "Admins can insert workspaces"
  on public.workspaces for insert
  with check (public.is_roster_admin(roster_id));

drop policy if exists "Admins can delete workspaces" on public.workspaces;
create policy "Admins can delete workspaces"
  on public.workspaces for delete
  using (public.is_roster_admin(roster_id));

drop policy if exists "Members can select player assignments" on public.player_assignments;
create policy "Members can select player assignments"
  on public.player_assignments for select
  using (public.can_read_workspace(workspace_id));

drop policy if exists "Editors can insert player assignments" on public.player_assignments;
create policy "Editors can insert player assignments"
  on public.player_assignments for insert
  with check (public.can_edit_workspace(workspace_id));

drop policy if exists "Editors can update player assignments" on public.player_assignments;
create policy "Editors can update player assignments"
  on public.player_assignments for update
  using (public.can_edit_workspace(workspace_id));

drop policy if exists "Editors can delete player assignments" on public.player_assignments;
create policy "Editors can delete player assignments"
  on public.player_assignments for delete
  using (public.can_edit_workspace(workspace_id));

-- Replace depth / sub / formation policies with workspace-aware ones.
drop policy if exists "Members can select depth chart entries" on public.depth_chart_entries;
drop policy if exists "Admins can insert depth chart entries" on public.depth_chart_entries;
drop policy if exists "Admins can update depth chart entries" on public.depth_chart_entries;
drop policy if exists "Admins can delete depth chart entries" on public.depth_chart_entries;

create policy "Members can select depth chart entries"
  on public.depth_chart_entries for select
  using (public.can_read_workspace(workspace_id));

create policy "Editors can insert depth chart entries"
  on public.depth_chart_entries for insert
  with check (public.can_edit_workspace(workspace_id));

create policy "Editors can update depth chart entries"
  on public.depth_chart_entries for update
  using (public.can_edit_workspace(workspace_id));

create policy "Editors can delete depth chart entries"
  on public.depth_chart_entries for delete
  using (public.can_edit_workspace(workspace_id));

drop policy if exists "Members can select sub order entries" on public.sub_order_entries;
drop policy if exists "Admins can insert sub order entries" on public.sub_order_entries;
drop policy if exists "Admins can update sub order entries" on public.sub_order_entries;
drop policy if exists "Admins can delete sub order entries" on public.sub_order_entries;

create policy "Members can select sub order entries"
  on public.sub_order_entries for select
  using (public.can_read_workspace(workspace_id));

create policy "Editors can insert sub order entries"
  on public.sub_order_entries for insert
  with check (public.can_edit_workspace(workspace_id));

create policy "Editors can update sub order entries"
  on public.sub_order_entries for update
  using (public.can_edit_workspace(workspace_id));

create policy "Editors can delete sub order entries"
  on public.sub_order_entries for delete
  using (public.can_edit_workspace(workspace_id));

drop policy if exists "Members can select formation assignments" on public.formation_assignments;
drop policy if exists "Admins can insert formation assignments" on public.formation_assignments;
drop policy if exists "Admins can update formation assignments" on public.formation_assignments;
drop policy if exists "Admins can delete formation assignments" on public.formation_assignments;

create policy "Members can select formation assignments"
  on public.formation_assignments for select
  using (
    workspace_id is null
    or public.can_read_workspace(workspace_id)
  );

create policy "Editors can insert formation assignments"
  on public.formation_assignments for insert
  with check (public.can_edit_workspace(workspace_id));

create policy "Editors can update formation assignments"
  on public.formation_assignments for update
  using (public.can_edit_workspace(workspace_id));

create policy "Editors can delete formation assignments"
  on public.formation_assignments for delete
  using (public.can_edit_workspace(workspace_id));

-- Shared player identity: members can edit the tryout list.
drop policy if exists "Admins can insert players" on public.players;
drop policy if exists "Admins can update players" on public.players;
drop policy if exists "Admins can delete players" on public.players;

drop policy if exists "Members can insert players" on public.players;
create policy "Members can insert players"
  on public.players for insert
  with check (public.is_roster_member(roster_id));

drop policy if exists "Members can update players" on public.players;
create policy "Members can update players"
  on public.players for update
  using (public.is_roster_member(roster_id));

drop policy if exists "Members can delete players" on public.players;
create policy "Members can delete players"
  on public.players for delete
  using (public.is_roster_member(roster_id));

do $$
begin
  alter publication supabase_realtime add table public.player_assignments;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.workspaces;
exception
  when duplicate_object then null;
end $$;

comment on table public.workspaces is
  'Personal overlays and Master Varsity/JV/Fr datasets for a tryout roster.';
comment on table public.player_assignments is
  'Per-workspace squad assignment, rank, and pin for a shared player.';
