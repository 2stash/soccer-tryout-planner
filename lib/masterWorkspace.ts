import type { PlayerAssignment, SquadTeam, WorkspaceKind } from '@/lib/types';
import { UNAVAILABLE_POOL } from '@/lib/types';
import {
  canonicalSquadForMaster,
  isMasterKind,
  type MasterKind,
} from '@/lib/masterConflicts';

/**
 * Shared workspace (and legacy personal): all assignment targets allowed.
 * Legacy master kinds retained only for old offline ops / migration edge cases.
 */
export function allowedAssignmentsForWorkspace(
  kind: WorkspaceKind | null
): PlayerAssignment[] | null {
  if (!kind || kind === 'shared' || kind === 'personal') return null;
  if (!isMasterKind(kind)) return null;
  return [canonicalSquadForMaster(kind), UNAVAILABLE_POOL];
}

export function isAllowedMasterAssignment(
  kind: WorkspaceKind | null,
  team: PlayerAssignment | null
): boolean {
  if (!kind || kind === 'shared' || kind === 'personal') return true;
  if (!isMasterKind(kind)) return true;
  if (team == null) return true;
  if (team === UNAVAILABLE_POOL) return true;
  return team === canonicalSquadForMaster(kind);
}

export function ownSquadForWorkspace(
  kind: WorkspaceKind | null
): SquadTeam | null {
  if (!kind || kind === 'shared' || kind === 'personal') return null;
  if (!isMasterKind(kind)) return null;
  return canonicalSquadForMaster(kind);
}

export function otherMasterKinds(active: MasterKind): MasterKind[] {
  const all: MasterKind[] = [
    'master_varsity',
    'master_jv',
    'master_fr_soph',
  ];
  return all.filter((k) => k !== active);
}
