-- Squad planner: assign each player to Varsity, JV, or Fr/Soph (or unassigned)

alter table public.players
  add column if not exists squad_team text
  check (squad_team is null or squad_team in ('varsity', 'jv', 'fr_soph'));

create index if not exists players_squad_team_idx
  on public.players (roster_id, squad_team);
