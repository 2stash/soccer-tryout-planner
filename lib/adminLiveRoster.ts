import {
  canonicalSquadForMaster,
  fetchMasterClaims,
  isMasterKind,
  masterWorkspaces,
  type MasterClaim,
  type MasterKind,
  MASTER_KINDS,
} from '@/lib/masterConflicts';
import {
  getStartersAndSubs,
  listDepthChartEntries,
  syncDepthChartTeam,
  type DepthChartEntry,
} from '@/lib/depthChart';
import {
  patchPlayer,
  setPlayerTeamRanks,
  type AvailableRankWrite,
} from '@/lib/players';
import { comparePlayersByName } from '@/lib/playerSort';
import { supabase } from '@/lib/supabase';
import { listSubOrderEntries, syncSubOrder, type SubOrderEntry } from '@/lib/subOrder';
import type {
  Player,
  PlayerAssignment,
  SquadTeam,
  Workspace,
} from '@/lib/types';
import { isSquadTeam, UNAVAILABLE_POOL } from '@/lib/types';

export type LiveAssignmentRow = {
  squad_team: PlayerAssignment | null;
  team_rank: number | null;
  available_pinned: boolean;
};

export type LiveMasterState = {
  masters: Workspace[];
  /** Official claims only (canonical squad per master). */
  claimsByPlayer: Map<string, MasterClaim[]>;
  /** workspaceId → playerId → assignment row */
  assignmentsByWorkspace: Map<string, Map<string, LiveAssignmentRow>>;
};

/** Prefer Varsity master for Available/Unavailable rank display. */
export function rankSourceMaster(masters: Workspace[]): Workspace | null {
  return (
    masters.find((w) => w.kind === 'master_varsity') ?? masters[0] ?? null
  );
}

export async function fetchLiveMasterState(
  workspaces: Workspace[]
): Promise<LiveMasterState> {
  const masters = masterWorkspaces(workspaces).filter((w) =>
    isMasterKind(w.kind)
  );
  const claimsByPlayer = await fetchMasterClaims(masters);
  const assignmentsByWorkspace = new Map<
    string,
    Map<string, LiveAssignmentRow>
  >();

  if (masters.length === 0) {
    return { masters, claimsByPlayer, assignmentsByWorkspace };
  }

  const ids = masters.map((w) => w.id);
  const { data, error } = await supabase
    .from('player_assignments')
    .select('workspace_id, player_id, squad_team, team_rank, available_pinned')
    .in('workspace_id', ids);

  if (error) throw error;

  for (const row of data ?? []) {
    const workspaceId = row.workspace_id as string;
    const playerId = row.player_id as string;
    let map = assignmentsByWorkspace.get(workspaceId);
    if (!map) {
      map = new Map();
      assignmentsByWorkspace.set(workspaceId, map);
    }
    map.set(playerId, {
      squad_team: (row.squad_team as PlayerAssignment | null) ?? null,
      team_rank: (row.team_rank as number | null) ?? null,
      available_pinned: Boolean(row.available_pinned),
    });
  }

  return { masters, claimsByPlayer, assignmentsByWorkspace };
}

function isUnavailableOnAnyMaster(
  playerId: string,
  masters: Workspace[],
  assignmentsByWorkspace: Map<string, Map<string, LiveAssignmentRow>>
): boolean {
  for (const master of masters) {
    const row = assignmentsByWorkspace.get(master.id)?.get(playerId);
    if (row?.squad_team === UNAVAILABLE_POOL) return true;
  }
  return false;
}

function poolMetaForPlayer(
  playerId: string,
  rankMaster: Workspace | null,
  assignmentsByWorkspace: Map<string, Map<string, LiveAssignmentRow>>
): { team_rank: number | null; available_pinned: boolean } {
  if (!rankMaster) return { team_rank: null, available_pinned: false };
  const row = assignmentsByWorkspace.get(rankMaster.id)?.get(playerId);
  return {
    team_rank: row?.team_rank ?? null,
    available_pinned: Boolean(row?.available_pinned),
  };
}

export type LiveRosterViews = {
  byTeam: Record<SquadTeam, Player[]>;
  available: Player[];
  unavailable: Player[];
};

/**
 * Build Live Admin columns from identity players + master assignment state.
 * Claimed players never appear in Available/Unavailable (claimed wins).
 * Existing multi-master conflicts stay visible on every claiming team.
 */
export function buildLiveRosterViews(
  players: Player[],
  state: LiveMasterState
): LiveRosterViews {
  const { masters, claimsByPlayer, assignmentsByWorkspace } = state;
  const rankMaster = rankSourceMaster(masters);

  const byTeam: Record<SquadTeam, Player[]> = {
    varsity: [],
    jv: [],
    fr_soph: [],
  };
  const available: Player[] = [];
  const unavailable: Player[] = [];

  for (const base of players) {
    const claims = claimsByPlayer.get(base.id) ?? [];
    if (claims.length > 0) {
      // Preserve dual claims in the UI — do not collapse to a single team.
      for (const claim of claims) {
        byTeam[claim.squadTeam].push({
          ...base,
          squad_team: claim.squadTeam,
          team_rank: null,
          available_pinned: false,
        });
      }
      continue;
    }

    const cut = isUnavailableOnAnyMaster(
      base.id,
      masters,
      assignmentsByWorkspace
    );
    const meta = poolMetaForPlayer(
      base.id,
      rankMaster,
      assignmentsByWorkspace
    );
    if (cut) {
      unavailable.push({
        ...base,
        squad_team: UNAVAILABLE_POOL,
        team_rank: meta.team_rank,
        available_pinned: meta.available_pinned,
      });
    } else {
      available.push({
        ...base,
        squad_team: null,
        team_rank: meta.team_rank,
        available_pinned: meta.available_pinned,
      });
    }
  }

  for (const key of Object.keys(byTeam) as SquadTeam[]) {
    byTeam[key] = [...byTeam[key]].sort(comparePlayersByName);
  }

  return { byTeam, available, unavailable };
}

async function syncMasterCanonicalSquad(params: {
  rosterId: string;
  master: Workspace;
  squadPlayers: Player[];
}): Promise<void> {
  const kind = params.master.kind;
  if (!isMasterKind(kind)) return;
  const squadTeam = canonicalSquadForMaster(kind);
  const withSquad = params.squadPlayers.map((p) => ({
    ...p,
    squad_team: squadTeam,
  }));
  const depthEntries = await syncDepthChartTeam({
    rosterId: params.rosterId,
    squadTeam,
    workspaceId: params.master.id,
    squadPlayers: withSquad,
  });
  const split = getStartersAndSubs(withSquad, depthEntries);
  await syncSubOrder({
    rosterId: params.rosterId,
    squadTeam,
    workspaceId: params.master.id,
    subPlayers: split.subs,
  });
}

function masterForKind(
  masters: Workspace[],
  kind: MasterKind
): Workspace | undefined {
  return masters.find((w) => w.kind === kind);
}

function masterForSquad(
  masters: Workspace[],
  squad: SquadTeam
): Workspace | undefined {
  const kind = MASTER_KINDS.find((k) => canonicalSquadForMaster(k) === squad);
  return kind ? masterForKind(masters, kind) : undefined;
}

function rebuildSquadPlayersByKind(
  players: Player[],
  claimsByPlayer: Map<string, MasterClaim[]>
): Partial<Record<MasterKind, Player[]>> {
  const playersById = new Map(players.map((p) => [p.id, p]));
  const squadPlayersByKind: Partial<Record<MasterKind, Player[]>> = {};
  for (const kind of MASTER_KINDS) {
    squadPlayersByKind[kind] = [];
  }
  for (const [pid, claims] of claimsByPlayer) {
    const base = playersById.get(pid);
    if (!base) continue;
    for (const claim of claims) {
      const list = squadPlayersByKind[claim.kind] ?? [];
      list.push({ ...base, squad_team: claim.squadTeam });
      squadPlayersByKind[claim.kind] = list;
    }
  }
  return squadPlayersByKind;
}

async function syncTouchedMasters(params: {
  rosterId: string;
  masters: Workspace[];
  players: Player[];
  claimsByPlayer: Map<string, MasterClaim[]>;
  touchedKinds: Iterable<MasterKind>;
}): Promise<void> {
  const squadPlayersByKind = rebuildSquadPlayersByKind(
    params.players,
    params.claimsByPlayer
  );
  // Depth/sub sync is best-effort. Assignment writes already committed —
  // failing here must not roll back or block Assign UI refresh.
  await Promise.all(
    [...params.touchedKinds].map(async (kind) => {
      const master = masterForKind(params.masters, kind);
      if (!master) return;
      try {
        await syncMasterCanonicalSquad({
          rosterId: params.rosterId,
          master,
          squadPlayers: squadPlayersByKind[kind] ?? [],
        });
      } catch {
        // Keep the squad assignment; depth can catch up on next edit.
      }
    })
  );
}

/**
 * Assign a player in Admin Live mode.
 *
 * - Available / Unavailable: clears every master (explicit resolve / cut).
 * - Team T: sets T and clears other masters so Admin cannot create new duals.
 *   Existing conflicts are only changed when Admin acts on that player.
 * Does not run on mode enter — only on explicit assign actions.
 */
export async function adminLiveAssign(params: {
  rosterId: string;
  masters: Workspace[];
  playerId: string;
  target: PlayerAssignment | null;
  /** Full roster identity rows (positions, names). */
  players: Player[];
  /** Current official claims before this write. */
  claimsByPlayer: Map<string, MasterClaim[]>;
}): Promise<void> {
  const masters = params.masters.filter((w) => isMasterKind(w.kind));
  if (masters.length === 0) {
    throw new Error('No master workspaces found');
  }

  const player = params.players.find((p) => p.id === params.playerId);
  if (!player) throw new Error('Player not found');

  const prevClaims = params.claimsByPlayer.get(params.playerId) ?? [];
  const touchedKinds = new Set<MasterKind>();
  for (const c of prevClaims) touchedKinds.add(c.kind);

  if (params.target === null) {
    await Promise.all(
      masters.map((m) =>
        patchPlayer(
          params.playerId,
          { squad_team: null, available_pinned: false },
          m.id
        )
      )
    );
  } else if (params.target === UNAVAILABLE_POOL) {
    await Promise.all(
      masters.map((m) =>
        patchPlayer(
          params.playerId,
          { squad_team: UNAVAILABLE_POOL, available_pinned: false },
          m.id
        )
      )
    );
  } else if (isSquadTeam(params.target)) {
    const targetMaster = masterForSquad(masters, params.target);
    if (!targetMaster || !isMasterKind(targetMaster.kind)) {
      throw new Error('No master workspace for that team');
    }
    touchedKinds.add(targetMaster.kind);
    // Choosing one team clears others — prevents new conflicts; also the
    // intentional way to resolve an existing dual by picking a single team.
    await Promise.all(
      masters.map((m) => {
        if (m.id === targetMaster.id) {
          return patchPlayer(
            params.playerId,
            { squad_team: params.target, available_pinned: false },
            m.id
          );
        }
        return patchPlayer(
          params.playerId,
          { squad_team: null, available_pinned: false },
          m.id
        );
      })
    );
  } else {
    throw new Error('Invalid assignment target');
  }

  const nextClaims = new Map(params.claimsByPlayer);
  if (
    params.target === null ||
    params.target === UNAVAILABLE_POOL ||
    !isSquadTeam(params.target)
  ) {
    nextClaims.delete(params.playerId);
  } else {
    const targetMaster = masterForSquad(masters, params.target);
    if (targetMaster && isMasterKind(targetMaster.kind)) {
      nextClaims.set(params.playerId, [
        {
          kind: targetMaster.kind,
          workspaceId: targetMaster.id,
          squadTeam: params.target,
        },
      ]);
    }
  }

  await syncTouchedMasters({
    rosterId: params.rosterId,
    masters,
    players: params.players,
    claimsByPlayer: nextClaims,
    touchedKinds,
  });
}

/**
 * Remove a player from one master team only. Other masters' claims stay
 * (so an existing conflict is not auto-cleared from the other side).
 */
export async function adminLiveRemoveFromTeam(params: {
  rosterId: string;
  masters: Workspace[];
  playerId: string;
  squadTeam: SquadTeam;
  players: Player[];
  claimsByPlayer: Map<string, MasterClaim[]>;
}): Promise<void> {
  const masters = params.masters.filter((w) => isMasterKind(w.kind));
  const targetMaster = masterForSquad(masters, params.squadTeam);
  if (!targetMaster || !isMasterKind(targetMaster.kind)) {
    throw new Error('No master workspace for that team');
  }

  // Always clear the target master — claimsByPlayer can lag the Assign UI.
  // Patching null is idempotent when already Available on that master.
  const prevClaims = params.claimsByPlayer.get(params.playerId) ?? [];

  await patchPlayer(
    params.playerId,
    { squad_team: null, available_pinned: false },
    targetMaster.id
  );

  const nextClaims = new Map(params.claimsByPlayer);
  const remaining = prevClaims.filter((c) => c.kind !== targetMaster.kind);
  if (remaining.length === 0) {
    nextClaims.delete(params.playerId);
  } else {
    nextClaims.set(params.playerId, remaining);
  }

  await syncTouchedMasters({
    rosterId: params.rosterId,
    masters,
    players: params.players,
    claimsByPlayer: nextClaims,
    touchedKinds: [targetMaster.kind],
  });
}

/** Write Available/Unavailable ranks to every master workspace. */
export async function adminLiveSetPoolRanks(params: {
  masters: Workspace[];
  ranks: AvailableRankWrite[];
}): Promise<void> {
  const masters = params.masters.filter((w) => isMasterKind(w.kind));
  if (params.ranks.length === 0 || masters.length === 0) return;
  await Promise.all(
    masters.map((m) => setPlayerTeamRanks(params.ranks, m.id))
  );
}

/** Master workspace that owns a canonical squad team. */
export function masterWorkspaceForSquad(
  masters: Workspace[],
  squad: SquadTeam
): Workspace | undefined {
  return masterForSquad(
    masters.filter((w) => isMasterKind(w.kind)),
    squad
  );
}

/**
 * Official Live squad members for a team (includes dual-claim players).
 * Prefer this over `players.filter(p => p.squad_team === squad)` — flatten
 * keeps only one squad_team per identity.
 */
export function liveSquadPlayersForTeam(
  players: Player[],
  squad: SquadTeam,
  state: LiveMasterState
): Player[] {
  return buildLiveRosterViews(players, state).byTeam[squad];
}

/**
 * Merge official master claims with flattened roster rows for a squad.
 * Keeps duals visible via claims, and keeps UI correct when claims lag a
 * local assign (flatten already has squad_team).
 */
export function mergeLiveSquadPlayers(params: {
  squad: SquadTeam;
  /** From MasterConflict.officialPlayers */
  claimedPlayers: Player[];
  /** From RosterData flattened live players */
  rosterPlayers: Player[];
}): Player[] {
  const byId = new Map<string, Player>();
  for (const p of params.claimedPlayers) {
    byId.set(p.id, { ...p, squad_team: params.squad });
  }
  for (const p of params.rosterPlayers) {
    if (p.squad_team !== params.squad) continue;
    if (!byId.has(p.id)) {
      byId.set(p.id, { ...p, squad_team: params.squad });
    }
  }
  return [...byId.values()].sort(comparePlayersByName);
}

/**
 * One Player row per identity for All Players / Depth / Rosters.
 * Multi-claim players keep the first claim on squad_team; conflict chips
 * surface the rest. Prefer buildLiveRosterViews / officialPlayers for
 * Assign columns that must show duals on every team.
 */
export function flattenLivePlayers(
  basePlayers: Player[],
  state: LiveMasterState
): Player[] {
  const views = buildLiveRosterViews(basePlayers, state);
  const byId = new Map<string, Player>();

  for (const team of ['varsity', 'jv', 'fr_soph'] as SquadTeam[]) {
    for (const p of views.byTeam[team]) {
      if (!byId.has(p.id)) byId.set(p.id, p);
    }
  }
  for (const p of views.unavailable) byId.set(p.id, p);
  for (const p of views.available) byId.set(p.id, p);

  return basePlayers.map(
    (base) =>
      byId.get(base.id) ?? {
        ...base,
        squad_team: null,
        team_rank: null,
        available_pinned: false,
      }
  );
}

export type LiveDepthCacheMap = Partial<
  Record<SquadTeam, { depthEntries: DepthChartEntry[]; subEntries: SubOrderEntry[] }>
>;

/** Read depth/sub caches for all three master canonical squads (no writes). */
export async function loadLiveDepthCache(params: {
  rosterId: string;
  masters: Workspace[];
}): Promise<LiveDepthCacheMap> {
  const masters = params.masters.filter((w) => isMasterKind(w.kind));
  const cache: LiveDepthCacheMap = {};

  await Promise.all(
    masters.map(async (master) => {
      const kind = master.kind as MasterKind;
      const squad = canonicalSquadForMaster(kind);
      const [depthEntries, subEntries] = await Promise.all([
        listDepthChartEntries(params.rosterId, squad, master.id),
        listSubOrderEntries(params.rosterId, squad, master.id),
      ]);
      cache[squad] = { depthEntries, subEntries };
    })
  );

  return cache;
}
