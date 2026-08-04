import {
  computeStarterSwapEntries,
  getStarterPositionsByPlayer,
  getStartersAndSubs,
  orderPlayersByDepth,
  type DepthChartEntry,
  type StarterSlot,
} from '@/lib/depthChart';
import { orderAvailablePlayers } from '@/lib/availableRank';
import { comparePlayersByName } from '@/lib/playerSort';
import {
  getDepthCanonicalPosition,
  getDepthStarterCount,
  normalizePositions,
  playerInDepthGroup,
  type PositionNumber,
} from '@/lib/positions';
import {
  buildSwappedSubOrder,
  orderPlayersBySubOrder,
  type SubOrderEntry,
} from '@/lib/subOrder';
import type { Player, SquadTeam } from '@/lib/types';
import { SQUAD_TEAMS, UNAVAILABLE_POOL } from '@/lib/types';

/** One table row: a filled player or a vacant starter slot placeholder. */
export type SquadSectionRow = {
  key: string;
  player: Player | null;
  role?: string;
  /** Position abbr for starter slots (e.g. ST); shown on vacant rows. */
  slotLabel?: string;
  /** Depth-group canonical position for starter slots. */
  positionGroup?: PositionNumber;
  /** Index within the depth group (0, or 1 for second CB). */
  slotIndex?: number;
  /** Dual-starter conflict on All Players formation. */
  conflict?: boolean;
  /** Other XI labels where this player also starts. */
  alsoLabels?: string[];
};

export type SquadPlayerSection = {
  title: string;
  /** Present for varsity / jv / fr_soph sections. */
  squadTeam?: SquadTeam;
  rows: SquadSectionRow[];
  /** Other-master live view: same formation UI, non-interactive. */
  readOnly?: boolean;
  /** Available / Unavailable ranked pool (All Players sort controls). */
  rankPool?: 'available' | 'unavailable';
};

export type SquadDepthCache = {
  depthEntries: DepthChartEntry[];
  subEntries: SubOrderEntry[];
};

export type SquadDepthView = {
  starters: Player[];
  subs: Player[];
  starterSlots: StarterSlot[];
  starterPositionsByPlayer: Record<string, PositionNumber[]>;
  orderedAtPosition: Player[];
  teamEntries: DepthChartEntry[];
};

export type DepthCacheMap = Partial<Record<SquadTeam, SquadDepthCache>>;

/** Fingerprint of depth-membership fields; changes require a depth sync. */
export function membershipKey(players: Player[]): string {
  return players
    .map(
      (p) =>
        `${p.id}:${p.squad_team ?? ''}:${normalizePositions(p.positions).join(',')}`
    )
    .sort()
    .join('|');
}

function reindexLocal(entries: DepthChartEntry[]): DepthChartEntry[] {
  const byPos = new Map<number, DepthChartEntry[]>();
  for (const entry of entries) {
    const list = byPos.get(entry.position_number) ?? [];
    list.push(entry);
    byPos.set(entry.position_number, list);
  }
  const next: DepthChartEntry[] = [];
  for (const [, list] of byPos) {
    list
      .sort((a, b) => a.sort_order - b.sort_order)
      .forEach((entry, index) => {
        next.push({ ...entry, sort_order: index + 1 });
      });
  }
  return next;
}

/**
 * Instant client-side depth cache update when a player's positions change.
 * Server sync should follow; this keeps the Starter/Sub UI snappy.
 */
export function optimisticPatchPositions(params: {
  cache: SquadDepthCache | undefined;
  squadPlayers: Player[];
  player: Player;
  prevPositions: number[];
  nextPositions: number[];
}): SquadDepthCache {
  const { cache, squadPlayers, player, prevPositions, nextPositions } = params;
  const prevCanon = new Set(
    normalizePositions(prevPositions).map((n) => getDepthCanonicalPosition(n))
  );
  const nextCanon = new Set(
    normalizePositions(nextPositions).map((n) => getDepthCanonicalPosition(n))
  );

  let depthEntries = [...(cache?.depthEntries ?? [])];

  for (const canonical of prevCanon) {
    if (nextCanon.has(canonical)) continue;
    depthEntries = depthEntries.filter(
      (e) => !(e.player_id === player.id && e.position_number === canonical)
    );
  }

  for (const canonical of nextCanon) {
    if (prevCanon.has(canonical)) continue;
    const already = depthEntries.some(
      (e) => e.player_id === player.id && e.position_number === canonical
    );
    if (already) continue;
    const atPos = depthEntries.filter((e) => e.position_number === canonical);
    const maxOrder = atPos.reduce((m, e) => Math.max(m, e.sort_order), 0);
    depthEntries.push({
      id: `local-${player.id}-${canonical}`,
      roster_id: player.roster_id,
      workspace_id: depthEntries[0]?.workspace_id ?? '',
      squad_team: player.squad_team as SquadTeam,
      position_number: canonical,
      player_id: player.id,
      sort_order: maxOrder + 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  }

  depthEntries = reindexLocal(depthEntries);
  const split = getStartersAndSubs(squadPlayers, depthEntries);
  const subEntries = rebuildSubEntries(
    player.roster_id,
    player.squad_team as SquadTeam,
    split.subs,
    cache?.subEntries ?? []
  );

  return { depthEntries, subEntries };
}

/**
 * Instant client-side starter swap for snappy All Players / formation UI.
 * Uses the same pure swap rules as DB persist (`computeStarterSwapEntries`).
 */
export function optimisticApplyStarterSwap(params: {
  rosterId: string;
  squadTeam: SquadTeam;
  cache: SquadDepthCache | undefined;
  /** Squad members after local squad/position patches. */
  squadPlayers: Player[];
  positionNumber: number;
  slotIndex: number;
  incomingPlayerId: string;
  outgoingPlayerId: string | null;
  previousSubIds: string[];
  incomingSubIndex: number | null;
}): SquadDepthCache {
  const canonical = getDepthCanonicalPosition(params.positionNumber);
  let depthEntries = [...(params.cache?.depthEntries ?? [])];
  const hasIncoming = depthEntries.some(
    (e) =>
      e.player_id === params.incomingPlayerId && e.position_number === canonical
  );
  if (!hasIncoming) {
    const atPos = depthEntries.filter((e) => e.position_number === canonical);
    const maxOrder = atPos.reduce((m, e) => Math.max(m, e.sort_order), 0);
    depthEntries.push({
      id: `local-${params.incomingPlayerId}-${canonical}`,
      roster_id: params.rosterId,
      workspace_id: depthEntries[0]?.workspace_id ?? '',
      squad_team: params.squadTeam,
      position_number: canonical,
      player_id: params.incomingPlayerId,
      sort_order: maxOrder + 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  }

  depthEntries = computeStarterSwapEntries({
    teamEntries: depthEntries,
    positionNumber: params.positionNumber,
    slotIndex: params.slotIndex,
    incomingPlayerId: params.incomingPlayerId,
    outgoingPlayerId: params.outgoingPlayerId,
  });
  depthEntries = reindexLocal(depthEntries);

  const split = getStartersAndSubs(params.squadPlayers, depthEntries);
  const subIdSet = new Set(split.subs.map((p) => p.id));
  const desiredSubIds = buildSwappedSubOrder({
    previousSubIds: params.previousSubIds,
    incomingPlayerId: params.incomingPlayerId,
    outgoingPlayerId: params.outgoingPlayerId,
    incomingSubIndex: params.incomingSubIndex,
  });
  // Outgoing must appear on the bench even if split lags for any reason.
  const orderedSubIds = [
    ...desiredSubIds.filter((id) => subIdSet.has(id)),
    ...split.subs.map((p) => p.id).filter((id) => !desiredSubIds.includes(id)),
  ];

  const previous = params.cache?.subEntries ?? [];
  const subEntries: SubOrderEntry[] = orderedSubIds.map((playerId, index) => {
    const existing = previous.find((e) => e.player_id === playerId);
    return {
      id: existing?.id ?? `local-sub-${playerId}`,
      roster_id: params.rosterId,
      workspace_id:
        existing?.workspace_id ?? depthEntries[0]?.workspace_id ?? '',
      squad_team: params.squadTeam,
      player_id: playerId,
      sort_order: index + 1,
      created_at: existing?.created_at ?? new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  });

  return { depthEntries, subEntries };
}

/** Rebuild sub-order rows from starter/sub split (display order preserved when possible). */
export function rebuildSubEntries(
  rosterId: string,
  squadTeam: SquadTeam,
  subs: Player[],
  previous: SubOrderEntry[]
): SubOrderEntry[] {
  const prevOrder = new Map(previous.map((e) => [e.player_id, e.sort_order]));
  const sorted = [...subs].sort((a, b) => {
    const ao = prevOrder.get(a.id) ?? Number.POSITIVE_INFINITY;
    const bo = prevOrder.get(b.id) ?? Number.POSITIVE_INFINITY;
    if (ao !== bo) return ao - bo;
    return comparePlayersByName(a, b);
  });
  return sorted.map((p, index) => {
    const existing = previous.find((e) => e.player_id === p.id);
    return {
      id: existing?.id ?? `local-sub-${p.id}`,
      roster_id: rosterId,
      workspace_id: existing?.workspace_id ?? previous[0]?.workspace_id ?? '',
      squad_team: squadTeam,
      player_id: p.id,
      sort_order: index + 1,
      created_at: existing?.created_at ?? new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  });
}

function sectionForSquad(
  title: string,
  squadTeam: SquadTeam,
  starterSlots: StarterSlot[],
  subs: Player[]
): SquadPlayerSection {
  const rows: SquadSectionRow[] = [
    ...starterSlots.map((slot) => ({
      key: slot.key,
      player: slot.player,
      role: slot.label,
      slotLabel: slot.label,
      positionGroup: slot.group,
      slotIndex: slot.index,
      conflict: slot.conflict,
      alsoLabels: slot.alsoLabels,
    })),
    ...subs.map((p) => ({
      key: p.id,
      player: p,
      role: 'Sub',
    })),
  ];
  return { title, squadTeam, rows };
}

function positionSectionForSquad(
  title: string,
  squadTeam: SquadTeam,
  atPosition: Player[],
  teamEntries: DepthChartEntry[],
  positionNumber: number
): SquadPlayerSection {
  const canonical = getDepthCanonicalPosition(positionNumber);
  const starterCount = getDepthStarterCount(positionNumber);
  const positionEntries = teamEntries.filter(
    (e) => e.position_number === canonical
  );
  const ordered = orderPlayersByDepth(atPosition, positionEntries);

  const rows: SquadSectionRow[] = ordered.map((p, index) => ({
    key: p.id,
    player: p,
    role: index < starterCount ? 'Starter' : 'Sub',
  }));

  return { title, squadTeam, rows };
}

function viewFromCache(
  squadPlayers: Player[],
  cache: SquadDepthCache | undefined,
  positionNumber?: number
): {
  starters: Player[];
  subs: Player[];
  starterSlots: StarterSlot[];
  conflictStarterSlots: StarterSlot[];
  starterPositionsByPlayer: Record<string, PositionNumber[]>;
  orderedAtPosition: Player[];
  teamEntries: DepthChartEntry[];
} {
  const teamEntries = cache?.depthEntries ?? [];
  const split = getStartersAndSubs(squadPlayers, teamEntries);
  const starterMap = getStarterPositionsByPlayer(squadPlayers, teamEntries);
  const orderedSubs = orderPlayersBySubOrder(
    split.subs,
    cache?.subEntries ?? []
  );

  let orderedAtPosition: Player[] = [];
  if (positionNumber != null) {
    const atPosition = squadPlayers.filter((p) =>
      playerInDepthGroup(p.positions, positionNumber)
    );
    const canonical = getDepthCanonicalPosition(positionNumber);
    const positionEntries = teamEntries.filter(
      (e) => e.position_number === canonical
    );
    orderedAtPosition = orderPlayersByDepth(atPosition, positionEntries);
  }

  return {
    starters: split.starters,
    subs: orderedSubs,
    /** Unique XI for Depth right panel / Rosters-style views. */
    starterSlots: split.starterSlots,
    /** Conflict-aware XI for All Players formation. */
    conflictStarterSlots: split.conflictStarterSlots,
    starterPositionsByPlayer: Object.fromEntries(starterMap),
    orderedAtPosition,
    teamEntries,
  };
}

function playersToRows(players: Player[]): SquadSectionRow[] {
  return players.map((p) => ({ key: p.id, player: p }));
}

/** Fallback when depth cache is unavailable. */
export function buildSimpleSquadSections(players: Player[]): SquadPlayerSection[] {
  const next: SquadPlayerSection[] = [];
  for (const team of SQUAD_TEAMS) {
    const squadPlayers = players
      .filter((p) => p.squad_team === team.id)
      .sort(comparePlayersByName);
    if (squadPlayers.length === 0) continue;
    next.push({ title: team.label, rows: playersToRows(squadPlayers) });
  }
  const available = orderAvailablePlayers(
    players.filter((p) => p.squad_team == null)
  );
  if (available.length > 0) {
    next.push({
      title: 'Available',
      rankPool: 'available',
      rows: playersToRows(available),
    });
  }
  const unavailable = orderAvailablePlayers(
    players.filter((p) => p.squad_team === UNAVAILABLE_POOL)
  );
  if (unavailable.length > 0) {
    next.push({
      title: 'Unavailable',
      rankPool: 'unavailable',
      rows: playersToRows(unavailable),
    });
  }
  return next;
}

export function buildSimplePositionSections(
  players: Player[],
  positionNumber: number
): SquadPlayerSection[] {
  return buildSimpleSquadSections(
    players.filter((p) => playerInDepthGroup(p.positions, positionNumber))
  );
}

/**
 * Build a squad section with XI slots + subs from an explicit squad list.
 * Does not re-filter by `player.squad_team` (needed for other-master RO views).
 */
export function buildFormationSectionFromPlayers(
  title: string,
  squadTeam: SquadTeam,
  squadPlayers: Player[],
  cache: SquadDepthCache | undefined,
  options?: { readOnly?: boolean }
): SquadPlayerSection {
  const view = viewFromCache(squadPlayers, cache);
  return {
    ...sectionForSquad(
      title,
      squadTeam,
      view.conflictStarterSlots,
      view.subs
    ),
    readOnly: options?.readOnly,
  };
}

/**
 * Build a squad section with XI slots + subs even when the squad is empty.
 * Used so head-coach All Players always shows their own team shell.
 */
export function buildSquadFormationSection(
  squadTeam: SquadTeam,
  players: Player[],
  cache: DepthCacheMap
): SquadPlayerSection {
  const team = SQUAD_TEAMS.find((t) => t.id === squadTeam);
  const title = team?.label ?? squadTeam;
  const squadPlayers = players.filter((p) => p.squad_team === squadTeam);
  return buildFormationSectionFromPlayers(
    title,
    squadTeam,
    squadPlayers,
    cache[squadTeam]
  );
}

/** Pure read: build All Players + optional position sections from cache. */
export function buildViewsFromCache(
  players: Player[],
  cache: DepthCacheMap,
  positionNumber?: number,
  alwaysIncludeSquads: SquadTeam[] = []
): {
  squadSections: SquadPlayerSection[];
  positionSections: SquadPlayerSection[];
} {
  const squadSections: SquadPlayerSection[] = [];
  const positionSections: SquadPlayerSection[] = [];
  const always = new Set(alwaysIncludeSquads);

  for (const team of SQUAD_TEAMS) {
    const squadPlayers = players.filter((p) => p.squad_team === team.id);
    if (squadPlayers.length === 0 && !always.has(team.id)) continue;

    const view = viewFromCache(squadPlayers, cache[team.id], positionNumber);
    squadSections.push(
      sectionForSquad(
        team.label,
        team.id,
        view.conflictStarterSlots,
        view.subs
      )
    );

    if (positionNumber != null) {
      const atPosition = squadPlayers.filter((p) =>
        playerInDepthGroup(p.positions, positionNumber)
      );
      // Always show team shells when requested (Depth "All players" middle pane).
      if (atPosition.length > 0 || always.has(team.id)) {
        positionSections.push(
          positionSectionForSquad(
            team.label,
            team.id,
            atPosition,
            view.teamEntries,
            positionNumber
          )
        );
      }
    }
  }

  const available = orderAvailablePlayers(
    players.filter((p) => p.squad_team == null)
  );
  // Always include Available so the tab shell stays visible while loading.
  squadSections.push({
    title: 'Available',
    rankPool: 'available',
    rows: playersToRows(available),
  });
  if (positionNumber != null) {
    const availableAtPos = available.filter((p) =>
      playerInDepthGroup(p.positions, positionNumber)
    );
    if (availableAtPos.length > 0 || available.length === 0) {
      positionSections.push({
        title: 'Available',
        rankPool: 'available',
        rows: playersToRows(availableAtPos),
      });
    }
  }
  const unavailable = orderAvailablePlayers(
    players.filter((p) => p.squad_team === UNAVAILABLE_POOL)
  );
  if (unavailable.length > 0) {
    squadSections.push({
      title: 'Unavailable',
      rankPool: 'unavailable',
      rows: playersToRows(unavailable),
    });
    if (positionNumber != null) {
      const unavailableAtPos = unavailable.filter((p) =>
        playerInDepthGroup(p.positions, positionNumber)
      );
      if (unavailableAtPos.length > 0) {
        positionSections.push({
          title: 'Unavailable',
          rows: playersToRows(unavailableAtPos),
        });
      }
    }
  }

  return { squadSections, positionSections };
}

/** Pure read: single-squad depth view from cache. */
export function getSquadDepthViewFromCache(params: {
  squadPlayers: Player[];
  cache: SquadDepthCache | undefined;
  positionNumber: number;
}): SquadDepthView {
  const view = viewFromCache(
    params.squadPlayers,
    params.cache,
    params.positionNumber
  );
  return {
    starters: view.starters,
    subs: view.subs,
    starterSlots: view.starterSlots,
    starterPositionsByPlayer: view.starterPositionsByPlayer,
    orderedAtPosition: view.orderedAtPosition,
    teamEntries: view.teamEntries,
  };
}
