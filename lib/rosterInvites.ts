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

type PendingInviteRow = RosterInvite & {
  roster_name: string;
  roster_owner_id: string;
  roster_created_at: string;
};

export async function listPendingInvitesForEmail(): Promise<
  PendingInviteWithRoster[]
> {
  const { data, error } = await supabase.rpc('list_my_pending_invites');
  if (error) throw error;

  return ((data ?? []) as PendingInviteRow[]).map((row) => ({
    id: row.id,
    roster_id: row.roster_id,
    email: row.email,
    role: row.role,
    invited_by: row.invited_by,
    status: row.status,
    created_at: row.created_at,
    accepted_at: row.accepted_at,
    accepted_user_id: row.accepted_user_id,
    roster: {
      id: row.roster_id,
      name: row.roster_name,
      owner_id: row.roster_owner_id,
      created_at: row.roster_created_at,
    },
  }));
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
