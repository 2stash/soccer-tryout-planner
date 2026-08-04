-- Repair / ensure shared workspace exists; idempotent remaster merge if masters remain.
-- Also exposes ensure_shared_workspace() so the app can self-heal after cutover.

-- Backfill shared rows (016 may have rolled back if run in one failed transaction).
insert into public.workspaces (roster_id, kind)
select r.id, 'shared'::public.workspace_kind
from public.rosters r
where not exists (
  select 1
  from public.workspaces w
  where w.roster_id = r.id
    and w.kind = 'shared'
);

-- If masters still exist, merge canonical data into shared (same rules as 016).
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

-- Formation copy is best-effort (skip on schema mismatch).
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

-- Only drop old overlays after shared exists for every roster that had them.
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

create or replace function public.ensure_shared_workspace(p_roster_id uuid)
returns public.workspaces
language plpgsql
security definer
set search_path = public
as $$
declare
  w public.workspaces;
begin
  if auth.uid() is null or not public.is_roster_member(p_roster_id) then
    raise exception 'Not a roster member';
  end if;

  select * into w
  from public.workspaces
  where roster_id = p_roster_id
    and kind = 'shared'
  limit 1;

  if found then
    return w;
  end if;

  insert into public.workspaces (roster_id, kind)
  values (p_roster_id, 'shared')
  returning * into w;

  return w;
end;
$$;

revoke all on function public.ensure_shared_workspace(uuid) from public;
grant execute on function public.ensure_shared_workspace(uuid) to authenticated;

-- Keep edit rights on shared (re-apply in case 016 never landed).
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

create or replace function public.handle_roster_member_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.workspaces (roster_id, kind)
  select new.roster_id, 'shared'::public.workspace_kind
  where not exists (
    select 1 from public.workspaces w
    where w.roster_id = new.roster_id and w.kind = 'shared'
  );
  return new;
end;
$$;

notify pgrst, 'reload schema';
