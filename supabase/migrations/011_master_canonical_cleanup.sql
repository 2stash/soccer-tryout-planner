-- Masters may only keep their canonical squad (+ Available / Unavailable).
-- Non-canonical playing-squad "notes" on a master move back to Available.
-- Depth / sub rows for non-canonical squads on masters are removed.

-- Varsity master: only varsity (or null / unavailable) stays.
update public.player_assignments pa
set
  squad_team = null,
  available_pinned = false,
  team_rank = null
from public.workspaces w
where pa.workspace_id = w.id
  and w.kind = 'master_varsity'
  and pa.squad_team in ('jv', 'fr_soph');

-- JV master: only jv stays.
update public.player_assignments pa
set
  squad_team = null,
  available_pinned = false,
  team_rank = null
from public.workspaces w
where pa.workspace_id = w.id
  and w.kind = 'master_jv'
  and pa.squad_team in ('varsity', 'fr_soph');

-- Fr/Soph master: only fr_soph stays.
update public.player_assignments pa
set
  squad_team = null,
  available_pinned = false,
  team_rank = null
from public.workspaces w
where pa.workspace_id = w.id
  and w.kind = 'master_fr_soph'
  and pa.squad_team in ('varsity', 'jv');

-- Drop non-canonical depth chart rows on masters.
delete from public.depth_chart_entries d
using public.workspaces w
where d.workspace_id = w.id
  and (
    (w.kind = 'master_varsity' and d.squad_team in ('jv', 'fr_soph'))
    or (w.kind = 'master_jv' and d.squad_team in ('varsity', 'fr_soph'))
    or (w.kind = 'master_fr_soph' and d.squad_team in ('varsity', 'jv'))
  );

-- Drop non-canonical sub order rows on masters.
delete from public.sub_order_entries s
using public.workspaces w
where s.workspace_id = w.id
  and (
    (w.kind = 'master_varsity' and s.squad_team in ('jv', 'fr_soph'))
    or (w.kind = 'master_jv' and s.squad_team in ('varsity', 'fr_soph'))
    or (w.kind = 'master_fr_soph' and s.squad_team in ('varsity', 'jv'))
  );

-- Drop non-canonical formation rows on masters (if any).
delete from public.formation_assignments f
using public.workspaces w
where f.workspace_id = w.id
  and (
    (w.kind = 'master_varsity' and f.squad_team in ('jv', 'fr_soph'))
    or (w.kind = 'master_jv' and f.squad_team in ('varsity', 'fr_soph'))
    or (w.kind = 'master_fr_soph' and f.squad_team in ('varsity', 'jv'))
  );

comment on table public.player_assignments is
  'Per-workspace squad assignment. Master workspaces only use their canonical squad plus Available/Unavailable.';
