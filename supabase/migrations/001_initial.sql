-- Soccer Tryout Planner — initial schema
-- Run in Supabase SQL Editor or via supabase db push

create extension if not exists "pgcrypto";

-- Profiles (mirrors auth.users)
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "Users can view own profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = id);

create policy "Users can insert own profile"
  on public.profiles for insert
  with check (auth.uid() = id);

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)));
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Rosters (tryout / planning sessions)
create table if not exists public.rosters (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists rosters_owner_id_idx on public.rosters (owner_id);

alter table public.rosters enable row level security;

create policy "Owners can select own rosters"
  on public.rosters for select
  using (auth.uid() = owner_id);

create policy "Owners can insert own rosters"
  on public.rosters for insert
  with check (auth.uid() = owner_id);

create policy "Owners can update own rosters"
  on public.rosters for update
  using (auth.uid() = owner_id);

create policy "Owners can delete own rosters"
  on public.rosters for delete
  using (auth.uid() = owner_id);

-- Players
create table if not exists public.players (
  id uuid primary key default gen_random_uuid(),
  roster_id uuid not null references public.rosters (id) on delete cascade,
  first_name text not null,
  last_name text not null,
  school_year text not null default '',
  position text not null default '',
  position_rank integer,
  team_rank integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists players_roster_id_idx on public.players (roster_id);

alter table public.players enable row level security;

create policy "Owners can select players in own rosters"
  on public.players for select
  using (
    exists (
      select 1 from public.rosters r
      where r.id = players.roster_id and r.owner_id = auth.uid()
    )
  );

create policy "Owners can insert players in own rosters"
  on public.players for insert
  with check (
    exists (
      select 1 from public.rosters r
      where r.id = players.roster_id and r.owner_id = auth.uid()
    )
  );

create policy "Owners can update players in own rosters"
  on public.players for update
  using (
    exists (
      select 1 from public.rosters r
      where r.id = players.roster_id and r.owner_id = auth.uid()
    )
  );

create policy "Owners can delete players in own rosters"
  on public.players for delete
  using (
    exists (
      select 1 from public.rosters r
      where r.id = players.roster_id and r.owner_id = auth.uid()
    )
  );

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists players_set_updated_at on public.players;
create trigger players_set_updated_at
  before update on public.players
  for each row execute procedure public.set_updated_at();

-- Realtime for multi-window / multi-device sync
do $$
begin
  alter publication supabase_realtime add table public.players;
exception
  when duplicate_object then null;
end $$;
