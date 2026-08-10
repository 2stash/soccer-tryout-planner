-- Tryout mode: roster lifecycle + per-player per-day attendance / tryout numbers.

alter table public.rosters
  add column if not exists tryout_active boolean not null default false;

alter table public.rosters
  add column if not exists tryout_day_count smallint null;

alter table public.rosters
  drop constraint if exists rosters_tryout_day_count_check;

alter table public.rosters
  add constraint rosters_tryout_day_count_check
  check (
    tryout_day_count is null
    or (tryout_day_count >= 1 and tryout_day_count <= 5)
  );

create table if not exists public.player_tryout_days (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players (id) on delete cascade,
  day smallint not null,
  tryout_number smallint null,
  attended boolean not null default false,
  updated_at timestamptz not null default now(),
  unique (player_id, day),
  constraint player_tryout_days_day_check check (day >= 1 and day <= 5),
  constraint player_tryout_days_number_check
    check (tryout_number is null or (tryout_number >= 1 and tryout_number <= 99))
);

create index if not exists player_tryout_days_player_id_idx
  on public.player_tryout_days (player_id);

drop trigger if exists player_tryout_days_set_updated_at on public.player_tryout_days;
create trigger player_tryout_days_set_updated_at
  before update on public.player_tryout_days
  for each row execute procedure public.set_updated_at();

alter table public.player_tryout_days enable row level security;

drop policy if exists "Members can select player tryout days" on public.player_tryout_days;
create policy "Members can select player tryout days"
  on public.player_tryout_days for select
  using (
    exists (
      select 1
      from public.players p
      where p.id = player_tryout_days.player_id
        and public.is_roster_member(p.roster_id)
    )
  );

drop policy if exists "Members can insert player tryout days" on public.player_tryout_days;
create policy "Members can insert player tryout days"
  on public.player_tryout_days for insert
  with check (
    exists (
      select 1
      from public.players p
      where p.id = player_tryout_days.player_id
        and public.is_roster_member(p.roster_id)
    )
  );

drop policy if exists "Members can update player tryout days" on public.player_tryout_days;
create policy "Members can update player tryout days"
  on public.player_tryout_days for update
  using (
    exists (
      select 1
      from public.players p
      where p.id = player_tryout_days.player_id
        and public.is_roster_member(p.roster_id)
    )
  );

drop policy if exists "Members can delete player tryout days" on public.player_tryout_days;
create policy "Members can delete player tryout days"
  on public.player_tryout_days for delete
  using (
    exists (
      select 1
      from public.players p
      where p.id = player_tryout_days.player_id
        and public.is_roster_member(p.roster_id)
    )
  );

do $$
begin
  alter publication supabase_realtime add table public.player_tryout_days;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.rosters;
exception
  when duplicate_object then null;
end $$;
