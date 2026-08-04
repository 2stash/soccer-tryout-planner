-- Collapse personal + three-master overlays into one shared workspace per roster.
-- Any roster member can edit the shared dataset.
-- Requires 015_shared_workspace_enum.sql (enum value 'shared') already committed.

-- One shared workspace per roster.
insert into public.workspaces (roster_id, kind)
select r.id, 'shared'::public.workspace_kind
from public.rosters r
where not exists (
  select 1
  from public.workspaces w
  where w.roster_id = r.id
    and w.kind = 'shared'
);

-- Merge assignments: Varsity claim wins over JV over Fr/Soph; else unavailable; else available.
with masters as (
  select
    w.roster_id,
    w.id as workspace_id,
    w.kind,
    case w.kind
      when 'master_varsity' then 1
      when 'master_jv' then 2
      when 'master_fr_soph' then 3
      else 9
    end as priority
  from public.workspaces w
  where w.kind in ('master_varsity', 'master_jv', 'master_fr_soph')
),
canonical as (
  select
    m.roster_id,
    m.workspace_id,
    m.kind,
    m.priority,
    a.player_id,
    a.squad_team,
    a.team_rank,
    a.available_pinned,
    case
      when m.kind = 'master_varsity' and a.squad_team = 'varsity' then 1
      when m.kind = 'master_jv' and a.squad_team = 'jv' then 1
      when m.kind = 'master_fr_soph' and a.squad_team = 'fr_soph' then 1
      when a.squad_team = 'unavailable' then 2
      when a.squad_team is null then 3
      else 9
    end as claim_rank
  from masters m
  join public.player_assignments a on a.workspace_id = m.workspace_id
),
picked as (
  select distinct on (c.roster_id, c.player_id)
    c.roster_id,
    c.player_id,
    c.squad_team,
    c.team_rank,
    c.available_pinned
  from canonical c
  where c.claim_rank < 9
  order by
    c.roster_id,
    c.player_id,
    c.claim_rank,
    c.priority
)
insert into public.player_assignments (
  workspace_id,
  player_id,
  squad_team,
  team_rank,
  available_pinned
)
select
  sw.id,
  p.player_id,
  p.squad_team,
  p.team_rank,
  coalesce(p.available_pinned, false)
from picked p
join public.workspaces sw
  on sw.roster_id = p.roster_id
 and sw.kind = 'shared'
on conflict (workspace_id, player_id) do update
set
  squad_team = excluded.squad_team,
  team_rank = excluded.team_rank,
  available_pinned = excluded.available_pinned,
  updated_at = now();

-- Depth: canonical squad rows from each master into shared.
insert into public.depth_chart_entries (
  roster_id,
  workspace_id,
  squad_team,
  position_number,
  player_id,
  sort_order
)
select
  d.roster_id,
  sw.id,
  d.squad_team,
  d.position_number,
  d.player_id,
  d.sort_order
from public.depth_chart_entries d
join public.workspaces mw on mw.id = d.workspace_id
join public.workspaces sw
  on sw.roster_id = d.roster_id
 and sw.kind = 'shared'
where
  (mw.kind = 'master_varsity' and d.squad_team = 'varsity')
  or (mw.kind = 'master_jv' and d.squad_team = 'jv')
  or (mw.kind = 'master_fr_soph' and d.squad_team = 'fr_soph')
on conflict (workspace_id, squad_team, position_number, player_id) do update
set sort_order = excluded.sort_order;

-- Sub order: same canonical merge.
insert into public.sub_order_entries (
  roster_id,
  workspace_id,
  squad_team,
  player_id,
  sort_order
)
select
  s.roster_id,
  sw.id,
  s.squad_team,
  s.player_id,
  s.sort_order
from public.sub_order_entries s
join public.workspaces mw on mw.id = s.workspace_id
join public.workspaces sw
  on sw.roster_id = s.roster_id
 and sw.kind = 'shared'
where
  (mw.kind = 'master_varsity' and s.squad_team = 'varsity')
  or (mw.kind = 'master_jv' and s.squad_team = 'jv')
  or (mw.kind = 'master_fr_soph' and s.squad_team = 'fr_soph')
on conflict (workspace_id, squad_team, player_id) do update
set sort_order = excluded.sort_order;

-- Formation assignments if present (best-effort; do not fail the cutover).
do $$
begin
  insert into public.formation_assignments (
    roster_id,
    workspace_id,
    squad_team,
    player_id,
    slot_number,
    depth_order
  )
  select
    f.roster_id,
    sw.id,
    f.squad_team,
    f.player_id,
    f.slot_number,
    f.depth_order
  from public.formation_assignments f
  join public.workspaces mw on mw.id = f.workspace_id
  join public.workspaces sw
    on sw.roster_id = f.roster_id
   and sw.kind = 'shared'
  where
    (
      (mw.kind = 'master_varsity' and f.squad_team = 'varsity')
      or (mw.kind = 'master_jv' and f.squad_team = 'jv')
      or (mw.kind = 'master_fr_soph' and f.squad_team = 'fr_soph')
    )
    and not exists (
      select 1
      from public.formation_assignments x
      where x.workspace_id = sw.id
        and x.squad_team = f.squad_team
        and x.player_id = f.player_id
    );
exception
  when others then
    raise notice 'formation_assignments merge skipped: %', sqlerrm;
end $$;

-- Drop old overlays only when shared exists for that roster.
delete from public.workspaces w
where w.kind in (
  'personal',
  'master_varsity',
  'master_jv',
  'master_fr_soph'
)
and exists (
  select 1
  from public.workspaces sw
  where sw.roster_id = w.roster_id
    and sw.kind = 'shared'
);

-- Any member can edit the shared workspace.
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
      and public.is_roster_member(w.roster_id)
      and w.kind = 'shared'
  );
$$;

-- Roster create: admin member + shared workspace only.
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
  select new.id, 'shared'::public.workspace_kind
  where not exists (
    select 1 from public.workspaces w
    where w.roster_id = new.id and w.kind = 'shared'
  );

  return new;
end;
$$;

-- Membership no longer creates personal workspaces.
create or replace function public.handle_roster_member_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Ensure shared workspace exists (idempotent).
  insert into public.workspaces (roster_id, kind)
  select new.roster_id, 'shared'::public.workspace_kind
  where not exists (
    select 1 from public.workspaces w
    where w.roster_id = new.roster_id and w.kind = 'shared'
  );
  return new;
end;
$$;

comment on type public.workspace_kind is
  'shared = one dataset for all coaches; legacy kinds removed after 016.';
