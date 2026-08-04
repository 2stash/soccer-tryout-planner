import { supabase } from '@/lib/supabase';
import type { RosterRole, Workspace, WorkspaceKind } from '@/lib/types';

export function workspaceKindLabel(kind: WorkspaceKind): string {
  if (kind === 'shared') return 'Shared';
  if (kind === 'personal') return 'Personal';
  if (kind === 'master_varsity') return 'Master Varsity';
  if (kind === 'master_jv') return 'Master JV';
  if (kind === 'master_fr_soph') return 'Master Fr/Soph';
  return 'Team';
}

/** All roles resolve to the single shared workspace. */
export function workspaceKindForRole(_role: RosterRole): WorkspaceKind {
  return 'shared';
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

/**
 * Prefer the shared workspace. Fall back to legacy overlays so the UI can
 * still load players if migration 016/017 has not finished yet.
 */
export function getSharedWorkspace(
  workspaces: Workspace[]
): Workspace | null {
  return (
    workspaces.find((w) => w.kind === 'shared') ??
    workspaces.find((w) => w.kind === 'personal') ??
    workspaces.find((w) => w.kind === 'master_varsity') ??
    workspaces.find((w) => w.kind === 'master_jv') ??
    workspaces.find((w) => w.kind === 'master_fr_soph') ??
    workspaces[0] ??
    null
  );
}

/** Create/fetch shared workspace via security-definer RPC (017+). */
export async function ensureSharedWorkspace(
  rosterId: string
): Promise<Workspace | null> {
  const { data, error } = await supabase.rpc('ensure_shared_workspace', {
    p_roster_id: rosterId,
  });
  if (error) {
    // RPC may be missing until 017 is applied — callers fall back to list.
    console.warn('ensure_shared_workspace:', error.message);
    return null;
  }
  return (data as Workspace | null) ?? null;
}

/**
 * List workspaces and ensure a shared row exists when possible.
 */
export async function listAndEnsureSharedWorkspace(
  rosterId: string
): Promise<Workspace[]> {
  let workspaces = await listRosterWorkspaces(rosterId);
  if (workspaces.some((w) => w.kind === 'shared')) return workspaces;

  const ensured = await ensureSharedWorkspace(rosterId);
  if (ensured) {
    workspaces = await listRosterWorkspaces(rosterId);
    if (workspaces.some((w) => w.kind === 'shared')) return workspaces;
    return [ensured, ...workspaces];
  }
  return workspaces;
}

/** Always returns the shared workspace for the roster (role ignored). */
export function resolveWorkspaceForRole(params: {
  workspaces: Workspace[];
  role: RosterRole | null;
  userId: string;
}): Workspace | null {
  return getSharedWorkspace(params.workspaces);
}
