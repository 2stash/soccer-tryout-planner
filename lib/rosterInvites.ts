import { supabase } from '@/lib/supabase';
import type { Roster, RosterInvite, RosterRole } from '@/lib/types';

export type PendingInviteWithRoster = RosterInvite & {
  roster: Roster;
};

const INVITEABLE_ROLES: RosterRole[] = [
  'varsity_coach',
  'jv_coach',
  'fr_soph_coach',
  'assistant',
];

export function isInviteableRole(role: RosterRole): boolean {
  return INVITEABLE_ROLES.includes(role);
}

export async function listRosterInvites(
  rosterId: string
): Promise<RosterInvite[]> {
  const { data, error } = await supabase
    .from('roster_invites')
    .select('*')
    .eq('roster_id', rosterId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data ?? []) as RosterInvite[];
}

export async function listPendingInvitesForEmail(): Promise<
  PendingInviteWithRoster[]
> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const email = user?.email?.trim().toLowerCase();
  if (!email) return [];

  // Filter by email: admins can SELECT all invites on their rosters via RLS,
  // so we must not show other people's invites on the invitee's Dashboard.
  const { data, error } = await supabase
    .from('roster_invites')
    .select('*, roster:rosters(*)')
    .eq('status', 'pending')
    .eq('email', email)
    .order('created_at', { ascending: false });

  if (error) throw error;

  const rows: PendingInviteWithRoster[] = [];
  for (const row of data ?? []) {
    const roster = row.roster as unknown as Roster | null;
    if (!roster?.id) continue;
    const { roster: _r, ...invite } = row as typeof row & {
      roster: Roster;
    };
    rows.push({ ...(invite as RosterInvite), roster });
  }
  return rows;
}

export async function createRosterInvite(params: {
  rosterId: string;
  email: string;
  role: RosterRole;
  invitedBy: string;
}): Promise<RosterInvite> {
  if (!isInviteableRole(params.role)) {
    throw new Error('Cannot invite someone as Admin.');
  }
  const email = params.email.trim().toLowerCase();
  if (!email || !email.includes('@')) {
    throw new Error('Enter a valid email address.');
  }

  const { data, error } = await supabase
    .from('roster_invites')
    .insert({
      roster_id: params.rosterId,
      email,
      role: params.role,
      invited_by: params.invitedBy,
      status: 'pending',
    })
    .select('*')
    .single();

  if (error) throw error;
  return data as RosterInvite;
}

export async function revokeRosterInvite(inviteId: string): Promise<void> {
  const { error } = await supabase
    .from('roster_invites')
    .update({ status: 'revoked' })
    .eq('id', inviteId)
    .eq('status', 'pending');

  if (error) throw error;
}

export async function acceptRosterInvite(
  inviteId: string
): Promise<RosterInvite> {
  const { data, error } = await supabase.rpc('accept_roster_invite', {
    p_invite_id: inviteId,
  });

  if (error) throw error;
  return data as RosterInvite;
}
