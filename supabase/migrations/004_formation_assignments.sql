-- Pitch Squad Planner: players placed into formation slots (1–11) per squad team

create table if not exists public.formation_assignments (
  id uuid primary key default gen_random_uuid(),
  roster_id uuid not null references public.rosters (id) on delete cascade,
  squad_team text not null check (squad_team in ('varsity', 'jv', 'fr_soph')),
  slot_number integer not null check (slot_number between 1 and 11),
  player_id uuid not null references public.players (id) on delete cascade,
  depth_order integer not null default 1 check (depth_order >= 1),
  created_at timestamptz not null default now(),
  unique (roster_id, squad_team, player_id)
);

create index if not exists formation_assignments_roster_team_idx
  on public.formation_assignments (roster_id, squad_team);

create index if not exists formation_assignments_slot_idx
  on public.formation_assignments (roster_id, squad_team, slot_number, depth_order);

alter table public.formation_assignments enable row level security;

create policy "Owners can select formation assignments"
  on public.formation_assignments for select
  using (
    exists (
      select 1 from public.rosters r
      where r.id = formation_assignments.roster_id and r.owner_id = auth.uid()
    )
  );

create policy "Owners can insert formation assignments"
  on public.formation_assignments for insert
  with check (
    exists (
      select 1 from public.rosters r
      where r.id = formation_assignments.roster_id and r.owner_id = auth.uid()
    )
  );

create policy "Owners can update formation assignments"
  on public.formation_assignments for update
  using (
    exists (
      select 1 from public.rosters r
      where r.id = formation_assignments.roster_id and r.owner_id = auth.uid()
    )
  );

create policy "Owners can delete formation assignments"
  on public.formation_assignments for delete
  using (
    exists (
      select 1 from public.rosters r
      where r.id = formation_assignments.roster_id and r.owner_id = auth.uid()
    )
  );

do $$
begin
  alter publication supabase_realtime add table public.formation_assignments;
exception
  when duplicate_object then null;
end $$;
