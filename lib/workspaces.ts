import { supabase } from '@/lib/supabase';
import type { RosterRole, Workspace, WorkspaceKind } from '@/lib/types';

export function workspaceKindLabel(kind: WorkspaceKind): string {
  if (kind === 'personal') return 'Personal';
  if (kind === 'master_varsity') return 'Master Varsity';
  if (kind === 'master_jv') return 'Master JV';
  return 'Master Fr/Soph';
}

/** Default workspace kind for the active coaching role. */
export function workspaceKindForRole(role: RosterRole): WorkspaceKind {
  if (role === 'varsity_coach') return 'master_varsity';
  if (role === 'jv_coach') return 'master_jv';
  if (role === 'fr_soph_coach') return 'master_fr_soph';
  return 'personal';
}

export async function listRosterWorkspaces(
  rosterId: string
): Promise<Workspace[]> {
  const { data, error } = await supabase
    .from('workspaces')
    .select('*')
    .eq('roster_id', rosterId);

  if (error) throw error;
  return (data ?? []) as Workspace[];
}

export function resolveWorkspaceForRole(params: {
  workspaces: Workspace[];
  role: RosterRole | null;
  userId: string;
}): Workspace | null {
  const { workspaces, role, userId } = params;
  if (!role) return null;
  const kind = workspaceKindForRole(role);
  if (kind === 'personal') {
    return (
      workspaces.find((w) => w.kind === 'personal' && w.user_id === userId) ??
      null
    );
  }
  return workspaces.find((w) => w.kind === kind) ?? null;
}
