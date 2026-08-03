-- Squad-wide substitute order (bench order), separate from per-position depth

create table if not exists public.sub_order_entries (
  id uuid primary key default gen_random_uuid(),
  roster_id uuid not null references public.rosters (id) on delete cascade,
  squad_team text not null check (squad_team in ('varsity', 'jv', 'fr_soph')),
  player_id uuid not null references public.players (id) on delete cascade,
  sort_order integer not null default 1 check (sort_order >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (roster_id, squad_team, player_id)
);

create index if not exists sub_order_entries_lookup_idx
  on public.sub_order_entries (roster_id, squad_team, sort_order);

alter table public.sub_order_entries enable row level security;

create policy "Owners can select sub order entries"
  on public.sub_order_entries for select
  using (
    exists (
      select 1 from public.rosters r
      where r.id = sub_order_entries.roster_id and r.owner_id = auth.uid()
    )
  );

create policy "Owners can insert sub order entries"
  on public.sub_order_entries for insert
  with check (
    exists (
      select 1 from public.rosters r
      where r.id = sub_order_entries.roster_id and r.owner_id = auth.uid()
    )
  );

create policy "Owners can update sub order entries"
  on public.sub_order_entries for update
  using (
    exists (
      select 1 from public.rosters r
      where r.id = sub_order_entries.roster_id and r.owner_id = auth.uid()
    )
  );

create policy "Owners can delete sub order entries"
  on public.sub_order_entries for delete
  using (
    exists (
      select 1 from public.rosters r
      where r.id = sub_order_entries.roster_id and r.owner_id = auth.uid()
    )
  );

drop trigger if exists sub_order_set_updated_at on public.sub_order_entries;
create trigger sub_order_set_updated_at
  before update on public.sub_order_entries
  for each row execute procedure public.set_updated_at();
