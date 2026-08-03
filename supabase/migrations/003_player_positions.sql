-- Multi-select standard positions (shirt numbers 1–11)

alter table public.players
  add column if not exists positions integer[] not null default '{}';

alter table public.players
  drop constraint if exists players_positions_valid;

alter table public.players
  add constraint players_positions_valid
  check (
    positions <@ array[1,2,3,4,5,6,7,8,9,10,11]::integer[]
  );

comment on column public.players.positions is
  'Standard soccer positions by shirt number 1–11 (multi-select).';

-- Keep legacy text "position" in sync for readability in the dashboard/table editor
-- App writes both; this backfills empty arrays from common abbreviations when possible.
update public.players
set positions = case
  when upper(position) in ('GK', 'GOALKEEPER') then array[1]
  when upper(position) in ('RB', 'RIGHT BACK') then array[2]
  when upper(position) in ('LB', 'LEFT BACK') then array[3]
  when upper(position) in ('CB', 'D', 'DEFENDER') then array[4]
  when upper(position) in ('CDM', 'DM') then array[6]
  when upper(position) in ('RW', 'RM', 'RMF') then array[7]
  when upper(position) in ('CM', 'MF', 'MID', 'MIDFIELDER') then array[8]
  when upper(position) in ('ST', 'CF', 'FORW', 'FORWARD', 'STRIKER') then array[9]
  when upper(position) in ('CAM', 'AM', 'ATT MID') then array[10]
  when upper(position) in ('LW', 'LM', 'LMF') then array[11]
  else positions
end
where coalesce(cardinality(positions), 0) = 0
  and coalesce(position, '') <> '';
