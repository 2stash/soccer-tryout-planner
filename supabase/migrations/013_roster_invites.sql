-- Pending coach invites by email (no outbound email in this phase).
-- Admin creates invites; invitee accepts after signing in with that email.

create type public.roster_invite_status as enum (
  'pending',
  'accepted',
  'revoked'
);

create table if not exists public.roster_invites (
  id uuid primary key default gen_random_uuid(),
  roster_id uuid not null references public.rosters (id) on delete cascade,
  email text not null,
  role public.roster_role not null,
  invited_by uuid not null references auth.users (id) on delete cascade,
  status public.roster_invite_status not null default 'pending',
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  accepted_user_id uuid references auth.users (id) on delete set null,
  constraint roster_invites_role_not_admin check (role <> 'admin'),
  constraint roster_invites_email_nonempty check (length(trim(email)) > 0)
);

create index if not exists roster_invites_roster_id_idx
  on public.roster_invites (roster_id);

create index if not exists roster_invites_email_pending_idx
  on public.roster_invites (lower(email))
  where status = 'pending';

-- One pending invite per email + role on a roster.
create unique index if not exists roster_invites_one_pending_email_role
  on public.roster_invites (roster_id, lower(email), role)
  where status = 'pending';

-- One pending head-coach seat per role on a roster.
create unique index if not exists roster_invites_one_pending_varsity
  on public.roster_invites (roster_id)
  where status = 'pending' and role = 'varsity_coach';

create unique index if not exists roster_invites_one_pending_jv
  on public.roster_invites (roster_id)
  where status = 'pending' and role = 'jv_coach';

create unique index if not exists roster_invites_one_pending_fr_soph
  on public.roster_invites (roster_id)
  where status = 'pending' and role = 'fr_soph_coach';

create or replace function public.normalize_invite_email()
returns trigger
language plpgsql
as $$
begin
  new.email := lower(trim(new.email));
  return new;
end;
$$;

drop trigger if exists roster_invites_normalize_email on public.roster_invites;
create trigger roster_invites_normalize_email
  before insert or update of email on public.roster_invites
  for each row execute procedure public.normalize_invite_email();

-- Cap assistants: existing members + pending invites <= 3.
create or replace function public.enforce_invite_assistant_cap()
returns trigger
language plpgsql
as $$
declare
  filled integer;
begin
  if new.role <> 'assistant' or new.status <> 'pending' then
    return new;
  end if;

  select (
    (select count(*)::integer
     from public.roster_members m
     where m.roster_id = new.roster_id and m.role = 'assistant')
    +
    (select count(*)::integer
     from public.roster_invites i
     where i.roster_id = new.roster_id
       and i.role = 'assistant'
       and i.status = 'pending'
       and i.id is distinct from new.id)
  ) into filled;

  if filled >= 3 then
    raise exception 'A roster may have at most 3 assistants (including pending invites)';
  end if;
  return new;
end;
$$;

drop trigger if exists roster_invites_assistant_cap on public.roster_invites;
create trigger roster_invites_assistant_cap
  before insert or update on public.roster_invites
  for each row execute procedure public.enforce_invite_assistant_cap();

-- Block pending invite when the head-coach seat is already filled.
create or replace function public.enforce_invite_seat_available()
returns trigger
language plpgsql
as $$
begin
  if new.status <> 'pending' then
    return new;
  end if;

  if new.role in ('varsity_coach', 'jv_coach', 'fr_soph_coach') then
    if exists (
      select 1
      from public.roster_members m
      where m.roster_id = new.roster_id
        and m.role = new.role
    ) then
      raise exception 'That coaching seat is already filled';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists roster_invites_seat_available on public.roster_invites;
create trigger roster_invites_seat_available
  before insert or update on public.roster_invites
  for each row execute procedure public.enforce_invite_seat_available();

alter table public.roster_invites enable row level security;

create policy "Admins can select roster invites"
  on public.roster_invites for select
  using (public.is_roster_admin(roster_id));

create policy "Invitees can select their pending invites"
  on public.roster_invites for select
  using (
    status = 'pending'
    and lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );

create policy "Admins can insert roster invites"
  on public.roster_invites for insert
  with check (
    public.is_roster_admin(roster_id)
    and invited_by = auth.uid()
  );

create policy "Admins can update roster invites"
  on public.roster_invites for update
  using (public.is_roster_admin(roster_id));

-- Accept: email must match JWT; insert membership; mark accepted.
create or replace function public.accept_roster_invite(p_invite_id uuid)
returns public.roster_invites
language plpgsql
security definer
set search_path = public
as $$
declare
  inv public.roster_invites;
  jwt_email text;
begin
  jwt_email := lower(trim(coalesce(auth.jwt() ->> 'email', '')));
  if jwt_email = '' or auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select * into inv
  from public.roster_invites
  where id = p_invite_id
  for update;

  if not found then
    raise exception 'Invite not found';
  end if;

  if inv.status <> 'pending' then
    raise exception 'Invite is no longer pending';
  end if;

  if lower(inv.email) <> jwt_email then
    raise exception 'This invite is for a different email address';
  end if;

  if inv.role in ('varsity_coach', 'jv_coach', 'fr_soph_coach') then
    if exists (
      select 1
      from public.roster_members m
      where m.roster_id = inv.roster_id
        and m.role = inv.role
    ) then
      raise exception 'That coaching seat is already filled';
    end if;
  end if;

  if inv.role = 'assistant' then
    if (
      select count(*)::integer
      from public.roster_members m
      where m.roster_id = inv.roster_id and m.role = 'assistant'
    ) >= 3 then
      raise exception 'A roster may have at most 3 assistants';
    end if;
  end if;

  insert into public.roster_members (roster_id, user_id, role)
  values (inv.roster_id, auth.uid(), inv.role)
  on conflict (roster_id, user_id, role) do nothing;

  update public.roster_invites
  set
    status = 'accepted',
    accepted_at = now(),
    accepted_user_id = auth.uid()
  where id = inv.id
  returning * into inv;

  return inv;
end;
$$;

revoke all on function public.accept_roster_invite(uuid) from public;
grant execute on function public.accept_roster_invite(uuid) to authenticated;

-- Invitees need roster name on Dashboard before they are members.
drop policy if exists "Pending invitees can select invited rosters" on public.rosters;
create policy "Pending invitees can select invited rosters"
  on public.rosters for select
  using (
    exists (
      select 1
      from public.roster_invites i
      where i.roster_id = id
        and i.status = 'pending'
        and lower(i.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    )
  );

comment on table public.roster_invites is
  'Pending coach invites by email. No outbound email in v1; invitee accepts from Dashboard after sign-in.';
