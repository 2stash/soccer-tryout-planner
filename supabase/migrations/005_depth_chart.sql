-- Depth chart: per-squad, per-position ordering (1 = starter, 2+ = subs)

create table if not exists public.depth_chart_entries (
  id uuid primary key default gen_random_uuid(),
  roster_id uuid not null references public.rosters (id) on delete cascade,
  squad_team text not null check (squad_team in ('varsity', 'jv', 'fr_soph')),
  position_number integer not null check (position_number between 1 and 11),
  player_id uuid not null references public.players (id) on delete cascade,
  sort_order integer not null default 1 check (sort_order >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (roster_id, squad_team, position_number, player_id)
);

create index if not exists depth_chart_entries_lookup_idx
  on public.depth_chart_entries (roster_id, squad_team, position_number, sort_order);

alter table public.depth_chart_entries enable row level security;

create policy "Owners can select depth chart entries"
  on public.depth_chart_entries for select
  using (
    exists (
      select 1 from public.rosters r
      where r.id = depth_chart_entries.roster_id and r.owner_id = auth.uid()
    )
  );

create policy "Owners can insert depth chart entries"
  on public.depth_chart_entries for insert
  with check (
    exists (
      select 1 from public.rosters r
      where r.id = depth_chart_entries.roster_id and r.owner_id = auth.uid()
    )
  );

create policy "Owners can update depth chart entries"
  on public.depth_chart_entries for update
  using (
    exists (
      select 1 from public.rosters r
      where r.id = depth_chart_entries.roster_id and r.owner_id = auth.uid()
    )
  );

create policy "Owners can delete depth chart entries"
  on public.depth_chart_entries for delete
  using (
    exists (
      select 1 from public.rosters r
      where r.id = depth_chart_entries.roster_id and r.owner_id = auth.uid()
    )
  );

drop trigger if exists depth_chart_set_updated_at on public.depth_chart_entries;
create trigger depth_chart_set_updated_at
  before update on public.depth_chart_entries
  for each row execute procedure public.set_updated_at();

do $$
begin
  alter publication supabase_realtime add table public.depth_chart_entries;
exception
  when duplicate_object then null;
end $$;
