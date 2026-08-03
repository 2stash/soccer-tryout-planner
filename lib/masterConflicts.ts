import { supabase } from '@/lib/supabase';
import type { SquadTeam, Workspace, WorkspaceKind } from '@/lib/types';
import { isSquadTeam } from '@/lib/types';

export type MasterKind =
  | 'master_varsity'
  | 'master_jv'
  | 'master_fr_soph';

export type MasterClaim = {
  kind: MasterKind;
  workspaceId: string;
  squadTeam: SquadTeam;
};

const MASTER_KINDS: MasterKind[] = [
  'master_varsity',
  'master_jv',
  'master_fr_soph',
];

/** Only this squad on that master counts as a real claim; other squads are notes. */
export function canonicalSquadForMaster(kind: MasterKind): SquadTeam {
  if (kind === 'master_varsity') return 'varsity';
  if (kind === 'master_jv') return 'jv';
  return 'fr_soph';
}

export function masterKindForSquad(squad: SquadTeam): MasterKind {
  if (squad === 'varsity') return 'master_varsity';
  if (squad === 'jv') return 'master_jv';
  return 'master_fr_soph';
}

export function isMasterKind(kind: WorkspaceKind): kind is MasterKind {
  return (
    kind === 'master_varsity' ||
    kind === 'master_jv' ||
    kind === 'master_fr_soph'
  );
}

export function masterKindShortLabel(kind: MasterKind): string {
  if (kind === 'master_varsity') return 'Varsity';
  if (kind === 'master_jv') return 'JV';
  return 'Fr/Soph';
}

export function masterWorkspaces(workspaces: Workspace[]): Workspace[] {
  return workspaces.filter((w) => isMasterKind(w.kind));
}

/**
 * Official claims only: Varsity master + varsity squad, JV master + jv, etc.
 * Assignments to other squads on a master are coach notes and do not conflict.
 */
export async function fetchMasterClaims(
  masterWorkspacesList: Workspace[]
): Promise<Map<string, MasterClaim[]>> {
  const masters = masterWorkspacesList.filter((w) => isMasterKind(w.kind));
  const byPlayer = new Map<string, MasterClaim[]>();
  if (masters.length === 0) return byPlayer;

  const ids = masters.map((w) => w.id);
  const kindById = new Map(
    masters.map((w) => [w.id, w.kind as MasterKind] as const)
  );

  const { data, error } = await supabase
    .from('player_assignments')
    .select('workspace_id, player_id, squad_team')
    .in('workspace_id', ids);

  if (error) throw error;

  for (const row of data ?? []) {
    const squad = row.squad_team as SquadTeam | 'unavailable' | null;
    if (!isSquadTeam(squad)) continue;
    const workspaceId = row.workspace_id as string;
    const kind = kindById.get(workspaceId);
    if (!kind) continue;
    // JV putting someone on "varsity" (or vice versa) is notes only.
    if (squad !== canonicalSquadForMaster(kind)) continue;
    const playerId = row.player_id as string;
    const list = byPlayer.get(playerId) ?? [];
    list.push({ kind, workspaceId, squadTeam: squad });
    byPlayer.set(playerId, list);
  }

  return byPlayer;
}

/**
 * Cross-master conflict labels only.
 *
 * Within one workspace a player has a single squad assignment (assigning to
 * another team moves them) — conflicts cannot be self-induced.
 *
 * Badges only appear when acting on a master (Varsity / JV / Fr) and THIS
 * master officially claims the player AND another master does too.
 * Personal overlays (Admin / Assistant) never show conflict chips.
 */
export function conflictLabelsForPlayer(params: {
  claims: MasterClaim[];
  activeKind: WorkspaceKind | null;
}): string[] {
  const { claims, activeKind } = params;
  if (!activeKind || !isMasterKind(activeKind)) return [];
  if (claims.length === 0) return [];

  const claimedHere = claims.some((c) => c.kind === activeKind);
  if (!claimedHere) return [];

  return MASTER_KINDS.filter(
    (kind) => kind !== activeKind && claims.some((c) => c.kind === kind)
  ).map(masterKindShortLabel);
}

/** True when no master officially claims this player. */
export function isGloballyUnclaimed(claims: MasterClaim[]): boolean {
  return claims.length === 0;
}

/**
 * Labels for other masters that also claim this player (Admin Live / multi-claim UI).
 * Unlike conflictLabelsForPlayer, does not require an active master workspace.
 */
export function otherClaimLabels(params: {
  claims: MasterClaim[];
  /** Omit this master's label (e.g. when rendering inside that team column). */
  excludeKind?: MasterKind;
}): string[] {
  const { claims, excludeKind } = params;
  if (claims.length < 2) return [];
  return MASTER_KINDS.filter(
    (kind) =>
      kind !== excludeKind && claims.some((c) => c.kind === kind)
  ).map(masterKindShortLabel);
}

/**
 * Tags for Available/Unavailable rows: other masters that already claim
 * this player (e.g. "On JV"), even if this master does not claim them.
 */
export function otherMasterClaimTags(params: {
  claims: MasterClaim[];
  activeKind: WorkspaceKind | null;
}): string[] {
  const { claims, activeKind } = params;
  if (claims.length === 0) return [];

  return MASTER_KINDS.filter((kind) => {
    if (activeKind && isMasterKind(activeKind) && kind === activeKind) {
      return false;
    }
    return claims.some((c) => c.kind === kind);
  }).map((kind) => `On ${masterKindShortLabel(kind)}`);
}

export function claimsForMaster(
  claimsByPlayer: Map<string, MasterClaim[]>,
  kind: MasterKind
): { playerId: string; claim: MasterClaim }[] {
  const rows: { playerId: string; claim: MasterClaim }[] = [];
  for (const [playerId, claims] of claimsByPlayer) {
    const claim = claims.find((c) => c.kind === kind);
    if (claim) rows.push({ playerId, claim });
  }
  return rows;
}

export { MASTER_KINDS };
