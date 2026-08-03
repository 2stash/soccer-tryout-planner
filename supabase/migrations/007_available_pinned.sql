-- Pin Available-pool players to the top of the unassigned ranking.

alter table public.players
  add column if not exists available_pinned boolean not null default false;

comment on column public.players.available_pinned is
  'When true and squad_team is null, player stays in the starred (top) Available band.';
