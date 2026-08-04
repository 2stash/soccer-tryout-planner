import { supabase } from '@/lib/supabase';
import type {
  Roster,
  RosterMember,
  RosterMembership,
  RosterRole,
} from '@/lib/types';
import { HEAD_COACH_ROLES } from '@/lib/types';

export function roleLabel(role: RosterRole): string {
  if (role === 'admin') return 'Admin';
  if (role === 'varsity_coach') return 'Varsity coach';
  if (role === 'jv_coach') return 'JV coach';
  if (role === 'fr_soph_coach') return 'Fr/Soph coach';
  return 'Assistant';
}

export async function listMyMemberships(userId: string): Promise<RosterMembership[]> {
  const { data, error } = await supabase
    .from('roster_members')
    .select('role, roster:rosters(*)')
    .eq('user_id', userId);

  if (error) throw error;

  const byRoster = new Map<string, RosterMembership>();
  for (const row of data ?? []) {
    const roster = row.roster as unknown as Roster | null;
    if (!roster?.id) continue;
    const existing = byRoster.get(roster.id);
    const role = row.role as RosterRole;
    if (existing) {
      if (!existing.roles.includes(role)) existing.roles.push(role);
    } else {
      byRoster.set(roster.id, {
        roster,
        roles: [role],
        isOwner: roster.owner_id === userId,
      });
    }
  }

  return [...byRoster.values()].sort(
    (a, b) =>
      new Date(b.roster.created_at).getTime() -
      new Date(a.roster.created_at).getTime()
  );
}

export async function listRosterMembers(
  rosterId: string
): Promise<RosterMember[]> {
  const { data, error } = await supabase
    .from('roster_members')
    .select('*')
    .eq('roster_id', rosterId)
    .order('created_at', { ascending: true });

  if (error) throw error;
  return (data ?? []) as RosterMember[];
}

export async function listMyRolesOnRoster(
  rosterId: string,
  userId: string
): Promise<RosterRole[]> {
  const { data, error } = await supabase
    .from('roster_members')
    .select('role')
    .eq('roster_id', rosterId)
    .eq('user_id', userId);

  if (error) throw error;
  return (data ?? []).map((r) => r.role as RosterRole);
}

export async function removeRosterRole(params: {
  rosterId: string;
  userId: string;
  role: RosterRole;
}): Promise<void> {
  if (params.role === 'admin') {
    throw new Error('Cannot remove the Admin role from here.');
  }
  const { error } = await supabase
    .from('roster_members')
    .delete()
    .eq('roster_id', params.rosterId)
    .eq('user_id', params.userId)
    .eq('role', params.role);

  if (error) throw error;
}

export function isHeadCoachRole(role: RosterRole): boolean {
  return HEAD_COACH_ROLES.includes(role);
}

export function pickDefaultActiveRole(roles: RosterRole[]): RosterRole {
  const order: RosterRole[] = [
    'admin',
    'varsity_coach',
    'jv_coach',
    'fr_soph_coach',
    'assistant',
  ];
  for (const role of order) {
    if (roles.includes(role)) return role;
  }
  return 'assistant';
}
