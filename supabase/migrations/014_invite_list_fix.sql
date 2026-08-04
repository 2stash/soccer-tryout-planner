-- Fix pending invites not visible to invitees:
-- auth.jwt() ->> 'email' is sometimes empty; nested roster select was dropped.

create or replace function public.auth_email()
returns text
language sql
stable
security definer
set search_path = public, auth
as $$
  select lower(trim(coalesce(
    nullif(auth.jwt() ->> 'email', ''),
    (select u.email::text from auth.users u where u.id = auth.uid())
  )));
$$;

revoke all on function public.auth_email() from public;
grant execute on function public.auth_email() to authenticated;

drop policy if exists "Invitees can select their pending invites" on public.roster_invites;
create policy "Invitees can select their pending invites"
  on public.roster_invites for select
  using (
    status = 'pending'
    and lower(email) = public.auth_email()
  );

drop policy if exists "Pending invitees can select invited rosters" on public.rosters;
create policy "Pending invitees can select invited rosters"
  on public.rosters for select
  using (
    exists (
      select 1
      from public.roster_invites i
      where i.roster_id = id
        and i.status = 'pending'
        and lower(i.email) = public.auth_email()
    )
  );

-- Reliable list for Dashboard (includes roster name; bypasses embed RLS quirks).
create or replace function public.list_my_pending_invites()
returns table (
  id uuid,
  roster_id uuid,
  email text,
  role public.roster_role,
  invited_by uuid,
  status public.roster_invite_status,
  created_at timestamptz,
  accepted_at timestamptz,
  accepted_user_id uuid,
  roster_name text,
  roster_owner_id uuid,
  roster_created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  me text;
begin
  me := public.auth_email();
  if me is null or me = '' or auth.uid() is null then
    return;
  end if;

  return query
  select
    i.id,
    i.roster_id,
    i.email,
    i.role,
    i.invited_by,
    i.status,
    i.created_at,
    i.accepted_at,
    i.accepted_user_id,
    r.name,
    r.owner_id,
    r.created_at
  from public.roster_invites i
  join public.rosters r on r.id = i.roster_id
  where i.status = 'pending'
    and lower(i.email) = me
  order by i.created_at desc;
end;
$$;

revoke all on function public.list_my_pending_invites() from public;
grant execute on function public.list_my_pending_invites() to authenticated;

-- Accept RPC: use auth_email() helper too.
create or replace function public.accept_roster_invite(p_invite_id uuid)
returns public.roster_invites
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  inv public.roster_invites;
  jwt_email text;
begin
  jwt_email := public.auth_email();
  if jwt_email = '' or jwt_email is null or auth.uid() is null then
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
