-- Unavailable assign pool (ranked like Available; not a playing squad).

alter table public.players
  drop constraint if exists players_squad_team_check;

alter table public.players
  add constraint players_squad_team_check
  check (
    squad_team is null
    or squad_team in ('varsity', 'jv', 'fr_soph', 'unavailable')
  );

comment on column public.players.squad_team is
  'Playing squad (varsity/jv/fr_soph), unavailable pool, or null = Available.';
